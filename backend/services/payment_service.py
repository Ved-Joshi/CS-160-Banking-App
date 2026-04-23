from calendar import monthrange
from datetime import date, datetime, time, timedelta, timezone
import hashlib
import json
import logging
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException, status

from config import settings
from utils.supabase import SupabaseUser, supabase_client

STALE_PROCESSING_TIMEOUT_MINUTES = 10
PAYMENT_MAX_AMOUNT = Decimal("100000.00")
IDEMPOTENCY_TTL_HOURS = 24
UTC = timezone.utc

logger = logging.getLogger(__name__)


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


def validate_payment_amount_or_raise(amount: float) -> None:
    try:
        amount_decimal = Decimal(str(amount))
    except (InvalidOperation, TypeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Payment amount is invalid.",
        ) from exc
    if amount_decimal <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Payment amount must be greater than zero.",
        )
    if amount_decimal > PAYMENT_MAX_AMOUNT:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Payment amount cannot exceed ${PAYMENT_MAX_AMOUNT}.",
        )
    if amount_decimal.as_tuple().exponent < -2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Payment amount supports at most two decimal places.",
        )


def _resolve_timezone_name(raw_timezone: str | None) -> str:
    timezone_name = (raw_timezone or "").strip() or "UTC"
    try:
        ZoneInfo(timezone_name)
        return timezone_name
    except ZoneInfoNotFoundError:
        logger.warning("Unknown profile timezone '%s'; falling back to UTC.", timezone_name)
        return "UTC"


async def get_user_timezone_name(user_id: str) -> str:
    rows = await supabase_client.select_rows(
        "profiles",
        select="timezone",
        filters={"id": f"eq.{user_id}"},
        limit=1,
    )
    timezone_name = rows[0].get("timezone") if rows else None
    return _resolve_timezone_name(timezone_name)


def local_today_for_timezone(timezone_name: str) -> date:
    tz = ZoneInfo(_resolve_timezone_name(timezone_name))
    return datetime.now(tz).date()


def parse_deliver_by_with_timezone(value: str, timezone_name: str) -> str:
    try:
        parsed = datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Deliver by date must be in YYYY-MM-DD format.",
        ) from exc

    if parsed < local_today_for_timezone(timezone_name):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Deliver by date cannot be in the past.",
        )

    return parsed.isoformat()


def next_run_at_for_date(deliver_by: str, timezone_name: str) -> str:
    run_date = date.fromisoformat(deliver_by)
    tz = ZoneInfo(_resolve_timezone_name(timezone_name))
    local_midnight = datetime.combine(run_date, datetime.min.time(), tzinfo=tz)
    return local_midnight.astimezone(UTC).isoformat()


def advance_payment_deliver_by(deliver_by: str, cadence: str) -> str:
    base_date = date.fromisoformat(deliver_by)
    next_date = _advance_payment_cadence(base_date, cadence)
    return next_date.isoformat()


def _roll_forward_to_today_or_later(base_date: date, cadence: str, today: date) -> date:
    cursor = base_date
    safety_counter = 0
    while cursor < today and safety_counter < 400:
        cursor = _advance_payment_cadence(cursor, cadence)
        safety_counter += 1
    return cursor


def _hash_idempotency_payload(payload: dict) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


async def get_idempotency_replay(
    *,
    user_id: str,
    endpoint: str,
    idempotency_key: str,
    request_payload: dict,
) -> dict | None:
    existing_rows = await supabase_client.select_rows(
        "payment_idempotency_keys",
        filters={
            "user_id": f"eq.{user_id}",
            "endpoint": f"eq.{endpoint}",
            "idempotency_key": f"eq.{idempotency_key}",
        },
        limit=1,
    )
    if not existing_rows:
        return None

    existing = existing_rows[0]
    expires_at = existing.get("expires_at")
    if isinstance(expires_at, str):
        try:
            if datetime.fromisoformat(expires_at.replace("Z", "+00:00")) <= datetime.now(UTC):
                return None
        except ValueError:
            return None

    incoming_hash = _hash_idempotency_payload(request_payload)
    if existing.get("request_hash") != incoming_hash:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Idempotency-Key already used with a different request payload.",
        )

    if existing.get("status") != "completed":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A request with this Idempotency-Key is still being processed.",
        )

    response_status = int(existing.get("response_status") or 200)
    response_body = existing.get("response_body") or {}
    if response_status >= 400:
        raise HTTPException(status_code=response_status, detail=response_body.get("detail", "Request failed."))
    return response_body


async def reserve_idempotency_key(
    *,
    user_id: str,
    endpoint: str,
    idempotency_key: str,
    request_payload: dict,
) -> None:
    now_utc = datetime.now(UTC)
    expires_at = now_utc + timedelta(hours=IDEMPOTENCY_TTL_HOURS)
    payload_hash = _hash_idempotency_payload(request_payload)
    try:
        await supabase_client.insert_row(
            "payment_idempotency_keys",
            {
                "user_id": user_id,
                "endpoint": endpoint,
                "idempotency_key": idempotency_key,
                "request_hash": payload_hash,
                "status": "in_progress",
                "response_body": None,
                "response_status": None,
                "expires_at": expires_at.isoformat(),
            },
        )
    except HTTPException as exc:
        if exc.status_code != status.HTTP_409_CONFLICT:
            raise
        existing_rows = await supabase_client.select_rows(
            "payment_idempotency_keys",
            filters={
                "user_id": f"eq.{user_id}",
                "endpoint": f"eq.{endpoint}",
                "idempotency_key": f"eq.{idempotency_key}",
            },
            limit=1,
        )
        if existing_rows:
            existing = existing_rows[0]
            expires_raw = str(existing.get("expires_at") or "")
            try:
                expired = datetime.fromisoformat(expires_raw.replace("Z", "+00:00")) <= now_utc
            except ValueError:
                expired = False
            if expired:
                await supabase_client.update_rows(
                    "payment_idempotency_keys",
                    {
                        "request_hash": payload_hash,
                        "status": "in_progress",
                        "response_body": None,
                        "response_status": None,
                        "expires_at": expires_at.isoformat(),
                    },
                    filters={
                        "user_id": f"eq.{user_id}",
                        "endpoint": f"eq.{endpoint}",
                        "idempotency_key": f"eq.{idempotency_key}",
                    },
                )
                return
        replay = await get_idempotency_replay(
            user_id=user_id,
            endpoint=endpoint,
            idempotency_key=idempotency_key,
            request_payload=request_payload,
        )
        if replay is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This request already completed. Retry with a new Idempotency-Key.",
            ) from exc
        raise


async def finalize_idempotency_key(
    *,
    user_id: str,
    endpoint: str,
    idempotency_key: str,
    response_body: dict,
    response_status: int,
) -> None:
    await supabase_client.update_rows(
        "payment_idempotency_keys",
        {
            "status": "completed",
            "response_body": response_body,
            "response_status": response_status,
        },
        filters={
            "user_id": f"eq.{user_id}",
            "endpoint": f"eq.{endpoint}",
            "idempotency_key": f"eq.{idempotency_key}",
        },
    )


def _parse_payment_date(value: str | None) -> date:
    if not value:
        raise ValueError("Deliver-by date is missing.")
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError("Deliver-by date is invalid.") from exc


def _advance_payment_cadence(base_date: date, cadence: str) -> date:
    normalized = (cadence or "once").lower()
    if normalized == "daily":
        return base_date + timedelta(days=1)
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


async def _set_payment_failure_notification(
    *,
    user_id: str,
    bill_payment_id: str,
    timezone_name: str,
    title: str,
    body: str,
) -> None:
    local_day = datetime.now(ZoneInfo(_resolve_timezone_name(timezone_name))).date().isoformat()
    dedupe_key = f"bill_payment_failure:{bill_payment_id}:{local_day}"
    try:
        await supabase_client.insert_row(
            "notifications",
            {
                "user_id": user_id,
                "bill_payment_id": bill_payment_id,
                "dedupe_key": dedupe_key,
                "type": "payment",
                "title": title,
                "body": body,
            },
        )
    except HTTPException:
        if exc.status_code == status.HTTP_409_CONFLICT:
            return
        return


async def attempt_payment_run(payment: dict) -> tuple[bool, str | None]:
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
        return False, "Funding account not found."

    account = account_rows[0]
    if account.get("status") != "open":
        return False, "Funding account is not open."

    if int(account.get("available_balance_cents") or 0) < amount_cents:
        return False, "Insufficient balance."

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
        return True, None
    except HTTPException as exc:
        detail = _format_error_detail(exc.detail)
        if "insufficient" in detail.lower():
            return False, "Insufficient balance."
        return False, detail
    except Exception as exc:  # pragma: no cover - defensive fallback
        return False, f"Unable to process payment: {str(exc)}"


def build_payment_update_payload(
    *,
    payment: dict,
    succeeded_run: bool,
    failure_reason: str | None,
    now_utc: datetime,
    timezone_name: str,
) -> dict:
    cadence = (payment.get("cadence") or "once").lower()
    is_recurring = cadence in {"daily", "weekly", "biweekly", "monthly"}
    deliver_by = _parse_payment_date(payment.get("deliver_by"))
    local_today = now_utc.astimezone(ZoneInfo(_resolve_timezone_name(timezone_name))).date()

    if succeeded_run:
        if not is_recurring:
            return {
                "status": "completed",
                "next_run_at": None,
                "processed_at": now_utc.isoformat(),
                "failure_reason": None,
            }

        success_base_date = deliver_by if deliver_by >= local_today else local_today
        next_date = _advance_payment_cadence(success_base_date, cadence)
        return {
            "status": "scheduled",
            "deliver_by": next_date.isoformat(),
            "next_run_at": next_run_at_for_date(next_date.isoformat(), timezone_name),
            "processed_at": now_utc.isoformat(),
            "failure_reason": None,
        }

    if not is_recurring:
        return {
            "status": "failed",
            "next_run_at": None,
            "processed_at": now_utc.isoformat(),
            "failure_reason": failure_reason or "Scheduled payment failed.",
        }

    # For recurring payments due today, keep the same due date until successful.
    if deliver_by == local_today:
        retry_date = deliver_by
    elif deliver_by < local_today:
        retry_date = _roll_forward_to_today_or_later(deliver_by, cadence, local_today)
    else:
        retry_date = deliver_by

    return {
        "status": "scheduled",
        "deliver_by": retry_date.isoformat(),
        "next_run_at": next_run_at_for_date(retry_date.isoformat(), timezone_name),
        "processed_at": now_utc.isoformat(),
        "failure_reason": failure_reason or "Scheduled payment failed.",
    }


async def process_due_bill_payments(*, batch_size: int = 50) -> dict[str, int]:
    """
    Process due bill payments where status='scheduled' and next_run_at <= now().

    For one-time payments:
    - success => completed
    - failure => failed

    For recurring payments:
    - success => cadence/date advanced and status returned to scheduled
    - failure => status remains scheduled with failure reason retained
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

    timezone_cache: dict[str, str] = {}

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

        timezone_name = timezone_cache.get(payment["user_id"])
        if timezone_name is None:
            timezone_name = await get_user_timezone_name(payment["user_id"])
            timezone_cache[payment["user_id"]] = timezone_name

        try:
            _parse_payment_date(payment.get("deliver_by"))
            succeeded_run, failure_reason = await attempt_payment_run(payment)
        except ValueError as exc:
            succeeded_run = False
            failure_reason = str(exc)

        update_payload = build_payment_update_payload(
            payment=payment,
            succeeded_run=succeeded_run,
            failure_reason=failure_reason,
            now_utc=now_utc,
            timezone_name=timezone_name,
        )
        await supabase_client.update_rows(
            "bill_payments",
            update_payload,
            filters={"id": f"eq.{payment['id']}"},
        )

        if succeeded_run:
            succeeded += 1
            continue

        failed += 1
        await _set_payment_failure_notification(
            user_id=payment["user_id"],
            bill_payment_id=payment["id"],
            timezone_name=timezone_name,
            title="Payment could not be processed",
            body=f"{failure_reason or 'Scheduled payment failed.'} Please review your account and try again.",
        )

    return {
        "reclaimed": reclaimed,
        "processed": processed,
        "succeeded": succeeded,
        "failed": failed,
    }
