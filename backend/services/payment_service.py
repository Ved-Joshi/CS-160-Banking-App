from calendar import monthrange
from datetime import date, datetime, time, timedelta, timezone

from fastapi import HTTPException, status

from config import settings
from utils.supabase import SupabaseUser, supabase_client

STALE_PROCESSING_TIMEOUT_MINUTES = 10


def _is_admin(current_user: SupabaseUser) -> bool:
    """Check if the user has admin role."""
    roles = current_user.app_metadata.get("roles") or current_user.user_metadata.get("roles") or []
    return isinstance(roles, list) and "admin" in roles


async def execute_payment_for_user(payment_id: str, current_user: SupabaseUser) -> dict:
    """
    Execute a scheduled bill payment for a user using a transactional RPC.
    
    This ensures atomicity: if the payment cannot be completed due to insufficient
    balance, no state is mutated (the payment remains scheduled for retry).
    
    Args:
        payment_id: The bill payment UUID
        current_user: The authenticated user
        
    Returns:
        The updated bill_payments row
        
    Raises:
        HTTPException: If payment not found, validation fails, or insufficient balance
    """
    # Authorization: dev-only endpoint - admin or debug mode only
    if not _is_admin(current_user) and not settings.DEBUG:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This endpoint is restricted to administrators.",
        )
    
    # Fetch payment and account info for validation (non-mutating reads)
    payment_rows = await supabase_client.select_rows(
        "bill_payments",
        filters={
            "id": f"eq.{payment_id}",
            "user_id": f"eq.{current_user.id}",
        },
        limit=1,
    )
    if not payment_rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payment not found.")

    payment = payment_rows[0]
    if payment.get("status") not in {"scheduled", "processing"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only scheduled or processing payments can be executed.",
        )

    account_rows = await supabase_client.select_rows(
        "accounts",
        filters={
            "id": f"eq.{payment['account_id']}",
            "user_id": f"eq.{current_user.id}",
            "status": "eq.open",
        },
        limit=1,
    )
    if not account_rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Funding account not found.")

    account = account_rows[0]
    amount_cents = int(payment.get("amount_cents") or 0)
    available_balance_cents = int(account.get("available_balance_cents") or 0)

    # Check balance BEFORE calling RPC - return error without mutation
    if available_balance_cents < amount_cents:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Insufficient balance.")

    # Call transactional RPC: all mutations happen atomically in Postgres
    # The RPC uses FOR UPDATE to lock the account, validates state, and performs
    # all updates (account, bill_payment, ledger_journals, transactions) in one transaction
    try:
        result = await supabase_client.rpc(
            "submit_bill_payment",
            {
                "p_user_id": current_user.id,
                "p_payment_id": payment_id,
                "p_account_id": payment["account_id"],
                "p_amount_cents": amount_cents,
            },
        )
    except HTTPException as exc:
        # RPC errors (e.g., insufficient balance, account not found) should propagate
        # with appropriate HTTP status codes
        if "Insufficient available balance" in str(exc.detail):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Insufficient balance.",
            ) from exc
        raise

    # Return the updated payment (fetch fresh from DB to ensure consistency)
    updated_rows = await supabase_client.select_rows(
        "bill_payments",
        filters={
            "id": f"eq.{payment_id}",
            "user_id": f"eq.{current_user.id}",
        },
        limit=1,
    )
    if not updated_rows:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch updated payment.",
        )

    return updated_rows[0]


def _format_error_detail(detail: str | dict) -> str:
    if isinstance(detail, dict):
        return str(detail.get("message", detail))
    return str(detail)


def _parse_payment_date(value: str | None) -> date:
    if not value:
        raise ValueError("Deliver-by date is missing.")
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError("Deliver-by date is invalid.") from exc


def _advance_payment_cadence(base_date: date, cadence: str) -> date:
    normalized = (cadence or "once").lower()
    if normalized == "weekly":
        return base_date + timedelta(days=7)
    if normalized == "biweekly":
        return base_date + timedelta(days=14)
    if normalized == "monthly":
        year = base_date.year + (1 if base_date.month == 12 else 0)
        month = 1 if base_date.month == 12 else base_date.month + 1
        day = min(base_date.day, monthrange(year, month)[1])
        return date(year, month, day)
    if normalized == "once":
        return base_date
    raise ValueError(f"Unsupported cadence: {cadence}")


def _next_run_at_for_date(run_date: date) -> str:
    local_tz = datetime.now().astimezone().tzinfo or timezone.utc
    local_dt = datetime.combine(run_date, time.min, tzinfo=local_tz)
    return local_dt.astimezone(timezone.utc).isoformat()


async def _set_payment_failure_notification(*, user_id: str, title: str, body: str) -> None:
    try:
        await supabase_client.insert_row(
            "notifications",
            {
                "user_id": user_id,
                "type": "payment",
                "title": title,
                "body": body,
            },
        )
    except HTTPException:
        return


async def process_due_bill_payments(*, batch_size: int = 50) -> dict[str, int]:
    """
    Process due bill payments where status='scheduled' and next_run_at <= now().

    For one-time payments:
    - success => completed
    - failure => failed

    For recurring payments (weekly/biweekly/monthly):
    - success => cadence/date advanced and status returned to scheduled
    - failure => cadence/date advanced, status remains scheduled, failure_reason retained
    """
    now_utc = datetime.now(timezone.utc)
    stale_cutoff = now_utc - timedelta(minutes=STALE_PROCESSING_TIMEOUT_MINUTES)

    stale_rows = await supabase_client.select_rows(
        "bill_payments",
        select="id",
        filters={
            "status": "eq.processing",
            "updated_at": f"lte.{stale_cutoff.isoformat()}",
        },
        limit=batch_size,
    )

    reclaimed = 0
    for stale in stale_rows:
        reset_rows = await supabase_client.update_rows(
            "bill_payments",
            {"status": "scheduled"},
            filters={"id": f"eq.{stale['id']}", "status": "eq.processing"},
        )
        if reset_rows:
            reclaimed += 1

    due_rows = await supabase_client.select_rows(
        "bill_payments",
        filters={
            "status": "eq.scheduled",
            "next_run_at": f"lte.{now_utc.isoformat()}",
        },
        order="next_run_at.asc",
        limit=batch_size,
    )

    processed = 0
    succeeded = 0
    failed = 0

    for row in due_rows:
        claimed_rows = await supabase_client.update_rows(
            "bill_payments",
            {"status": "processing"},
            filters={"id": f"eq.{row['id']}", "status": "eq.scheduled"},
        )
        if not claimed_rows:
            continue

        payment = claimed_rows[0]
        processed += 1

        cadence = (payment.get("cadence") or "once").lower()
        is_recurring = cadence in {"weekly", "biweekly", "monthly"}
        failure_reason: str | None = None
        succeeded_run = False

        try:
            deliver_by = _parse_payment_date(payment.get("deliver_by"))
        except ValueError as exc:
            failure_reason = str(exc)
            deliver_by = date.today()

        amount_cents = int(payment.get("amount_cents") or 0)
        account_rows = await supabase_client.select_rows(
            "accounts",
            filters={
                "id": f"eq.{payment['account_id']}",
                "user_id": f"eq.{payment['user_id']}",
            },
            limit=1,
        )

        if not account_rows:
            failure_reason = failure_reason or "Funding account not found."
        else:
            account = account_rows[0]
            if account.get("status") != "open":
                failure_reason = failure_reason or "Funding account is not open."
            elif int(account.get("available_balance_cents") or 0) < amount_cents:
                failure_reason = failure_reason or "Insufficient balance."
            else:
                try:
                    await supabase_client.rpc(
                        "submit_bill_payment",
                        {
                            "p_user_id": payment["user_id"],
                            "p_payment_id": payment["id"],
                            "p_account_id": payment["account_id"],
                            "p_amount_cents": amount_cents,
                        },
                    )
                    succeeded_run = True
                except HTTPException as exc:
                    detail = _format_error_detail(exc.detail)
                    if "insufficient" in detail.lower():
                        failure_reason = "Insufficient balance."
                    else:
                        failure_reason = detail
                except Exception as exc:  # pragma: no cover - defensive fallback
                    failure_reason = f"Unable to process payment: {str(exc)}"

        if succeeded_run:
            succeeded += 1
            if is_recurring:
                next_date = _advance_payment_cadence(deliver_by, cadence)
                await supabase_client.update_rows(
                    "bill_payments",
                    {
                        "status": "scheduled",
                        "deliver_by": next_date.isoformat(),
                        "next_run_at": _next_run_at_for_date(next_date),
                        "processed_at": now_utc.isoformat(),
                        "failure_reason": None,
                    },
                    filters={"id": f"eq.{payment['id']}"},
                )
            else:
                await supabase_client.update_rows(
                    "bill_payments",
                    {
                        "status": "completed",
                        "next_run_at": None,
                        "processed_at": now_utc.isoformat(),
                        "failure_reason": None,
                    },
                    filters={"id": f"eq.{payment['id']}"},
                )
            continue

        failed += 1
        await _set_payment_failure_notification(
            user_id=payment["user_id"],
            title="Payment could not be processed",
            body=f"{failure_reason or 'Scheduled payment failed.'} Please review your account and try again.",
        )

        if is_recurring:
            next_date = _advance_payment_cadence(deliver_by, cadence)
            await supabase_client.update_rows(
                "bill_payments",
                {
                    "status": "scheduled",
                    "deliver_by": next_date.isoformat(),
                    "next_run_at": _next_run_at_for_date(next_date),
                    "processed_at": now_utc.isoformat(),
                    "failure_reason": failure_reason or "Scheduled payment failed.",
                },
                filters={"id": f"eq.{payment['id']}"},
            )
        else:
            await supabase_client.update_rows(
                "bill_payments",
                {
                    "status": "failed",
                    "next_run_at": None,
                    "processed_at": now_utc.isoformat(),
                    "failure_reason": failure_reason or "Scheduled payment failed.",
                },
                filters={"id": f"eq.{payment['id']}"},
            )

    return {
        "reclaimed": reclaimed,
        "processed": processed,
        "succeeded": succeeded,
        "failed": failed,
    }
