from datetime import date, datetime, time, timezone, timedelta
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status

from schemas.banking import TransferResult
from utils.supabase import SupabaseUser, amount_to_cents, supabase_client
from services.ledger_service import ensure_ledger_accounts_for_transfer

STALE_PROCESSING_TIMEOUT_MINUTES = 10


def _is_admin(current_user: SupabaseUser) -> bool:
    roles = current_user.app_metadata.get("roles") or current_user.user_metadata.get("roles") or []
    return isinstance(roles, list) and "admin" in roles


async def _get_account(account_id: str) -> dict:
    rows = await supabase_client.select_rows(
        "accounts",
        filters={"id": f"eq.{account_id}"},
        limit=1,
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found.")
    return rows[0]


async def create_transfer_for_user(
    current_user: SupabaseUser,
    from_account_id: str,
    to_account_id: str,
    amount: float,
    memo: str | None,
    transfer_date: str,
) -> TransferResult:
    """
    Create and execute an internal transfer between accounts using a transactional RPC.
    
    This uses the submit_internal_transfer RPC to ensure all mutations happen atomically:
    - Account balance updates, transfer creation, journal entries, ledger postings, and
      transaction records are all applied in a single Postgres transaction with FOR UPDATE locks.
    
    If the transfer cannot be completed due to insufficient balance, no state is mutated
    and the request fails with 400 Bad Request.
    
    Args:
        current_user: The authenticated user
        from_account_id: Source account UUID
        to_account_id: Destination account UUID  
        amount: Transfer amount in dollars
        memo: Optional transfer memo
        transfer_date: Transfer date (must be current date)
        
    Returns:
        TransferResult with transfer ID, status, and submitted timestamp
        
    Raises:
        HTTPException: If validation fails or insufficient balance
    """
    if from_account_id == to_account_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot transfer to the same account.",
        )

    amount_cents = amount_to_cents(amount)
    if amount_cents <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Transfer amount must be greater than zero.",
        )

    # Fetch accounts for validation (non-mutating reads)
    from_account = await _get_account(from_account_id)
    to_account = await _get_account(to_account_id)

    if not _is_admin(current_user) and from_account["user_id"] != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to transfer from this account.",
        )

    if from_account["status"] != "open" or to_account["status"] != "open":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Both accounts must be open.",
        )

    if from_account["available_balance_cents"] < amount_cents:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Insufficient balance.",
        )

    # Ensure ledger accounts exist for both accounts (safety check)
    await ensure_ledger_accounts_for_transfer(from_account, to_account)

    # Call transactional RPC: all mutations happen atomically in Postgres
    # The RPC uses FOR UPDATE to lock both accounts, validates state, and performs
    # all updates (accounts, transfer, ledger_journals, ledger_postings, transactions, notifications)
    # in one transaction
    try:
        result = await supabase_client.rpc(
            "submit_internal_transfer",
            {
                "p_user_id": current_user.id,
                "p_from_account_id": from_account_id,
                "p_to_account_id": to_account_id,
                "p_amount_cents": amount_cents,
                "p_transfer_date": transfer_date,
                "p_memo": memo,
            },
        )
    except HTTPException as exc:
        # RPC errors should propagate with appropriate HTTP status codes
        if "Insufficient available funds" in str(exc.detail):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Insufficient balance.",
            ) from exc
        elif any(msg in str(exc.detail) for msg in ["not found", "open", "different accounts"]):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(exc.detail),
            ) from exc
        raise

    # Result contains: id, status, submitted_at from the RPC
    # Note: result may be a list with one row (Supabase RPC returns rows)
    if isinstance(result, list):
        result = result[0] if result else {}
    
    return TransferResult(
        id=result.get("id"),
        status="COMPLETED",
        submittedAt=result.get("submitted_at"),
    )


async def process_due_transfer_plans(*, batch_size: int = 50) -> dict[str, int]:
    """
    Process transfer plans that are due for execution.
    
    Finds transfer plans where status = 'scheduled' and next_run_at <= now(),
    then executes them using the submit_internal_transfer RPC.
    
    Args:
        batch_size: Maximum number of transfer plans to process in this batch
        
    Returns:
        Dictionary with processing statistics:
        - processed: Number of successfully processed transfers
        - failed: Number of transfers that failed to process
        - skipped: Number of transfers skipped (e.g., insufficient balance)
    """
    now_utc = datetime.now(timezone.utc)
    stale_cutoff = now_utc - timedelta(minutes=STALE_PROCESSING_TIMEOUT_MINUTES)

    # Recover plans that were claimed but never finalized (worker crash/restart).
    stale_processing_rows = await supabase_client.select_rows(
        "transfer_plans",
        select="id",
        filters={
            "status": "eq.processing",
            "updated_at": f"lte.{stale_cutoff.isoformat()}",
        },
        limit=batch_size,
    )

    reclaimed = 0
    for stale in stale_processing_rows:
        reset_rows = await supabase_client.update_rows(
            "transfer_plans",
            {
                "status": "scheduled",
            },
            filters={"id": f"eq.{stale['id']}", "status": "eq.processing"},
        )
        if reset_rows:
            reclaimed += 1

    due_rows = await supabase_client.select_rows(
        "transfer_plans",
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
            "transfer_plans",
            {"status": "processing"},
            filters={"id": f"eq.{row['id']}", "status": "eq.scheduled"},
        )
        if not claimed_rows:
            continue

        plan = claimed_rows[0]
        processed += 1

        cadence = plan["cadence"]
        timezone_name = plan["timezone"]
        last_failure_reason: str | None = None
        try:
            run_time = _parse_local_time(plan.get("run_time"), field_name="runTime")
            next_run_at = datetime.fromisoformat(plan["next_run_at"].replace("Z", "+00:00"))
            local_run_date = next_run_at.astimezone(ZoneInfo(timezone_name)).date()
            end_date = _parse_iso_date(plan["end_date"], field_name="endDate") if plan.get("end_date") else None

            await execute_transfer_run(
                user_id=plan["user_id"],
                actor_user_id=plan["user_id"],
                from_account_id=plan["from_account_id"],
                to_account_id=plan["to_account_id"],
                amount_cents=plan["amount_cents"],
                memo=plan.get("memo"),
                transfer_date=local_run_date.isoformat(),
                transfer_plan_id=plan["id"],
                enforce_user_ownership=True,
            )
            succeeded += 1
        except HTTPException as exc:
            failed += 1
            last_failure_reason = _format_error_detail(exc.detail)
            await supabase_client.insert_row(
                "transfers",
                {
                    "user_id": plan["user_id"],
                    "from_account_id": plan["from_account_id"],
                    "to_account_id": plan["to_account_id"],
                    "amount_cents": plan["amount_cents"],
                    "memo": plan.get("memo"),
                    "transfer_date": local_run_date.isoformat(),
                    "status": "failed",
                    "failure_reason": last_failure_reason,
                    "transfer_plan_id": plan["id"],
                },
            )
        except Exception as exc:
            failed += 1
            last_failure_reason = f"Unable to process transfer plan: {str(exc)}"
            await supabase_client.update_rows(
                "transfer_plans",
                {
                    "status": "cancelled",
                    "last_run_at": now_utc.isoformat(),
                    "next_run_at": None,
                    "last_failure_reason": last_failure_reason,
                },
                filters={"id": f"eq.{plan['id']}"},
            )
            continue

        if cadence == "once":
            await supabase_client.update_rows(
                "transfer_plans",
                {
                    "status": "completed",
                    "last_run_at": now_utc.isoformat(),
                    "next_run_at": None,
                    "last_failure_reason": last_failure_reason,
                },
                filters={"id": f"eq.{plan['id']}"},
            )
            continue

        following_date = _advance_cadence(local_run_date, cadence)
        if end_date and following_date > end_date:
            await supabase_client.update_rows(
                "transfer_plans",
                {
                    "status": "completed",
                    "last_run_at": now_utc.isoformat(),
                    "next_run_at": None,
                    "last_failure_reason": last_failure_reason,
                },
                filters={"id": f"eq.{plan['id']}"},
            )
            continue

        following_run_at = _combine_local_to_utc(following_date, run_time, timezone_name)
        await supabase_client.update_rows(
            "transfer_plans",
            {
                "status": "scheduled",
                "last_run_at": now_utc.isoformat(),
                "next_run_at": following_run_at.isoformat(),
                "last_failure_reason": last_failure_reason,
            },
            filters={"id": f"eq.{plan['id']}"},
        )
    
    return {
        "reclaimed": reclaimed,
        "processed": processed,
        "succeeded": succeeded,
        "failed": failed,
    }


def _parse_local_time(value: str | None, *, field_name: str) -> time:
    """Parse a time string in HH:MM format."""
    if not value:
        raise ValueError(f"{field_name} is required")
    try:
        return datetime.strptime(value, "%H:%M").time()
    except ValueError as exc:
        raise ValueError(f"{field_name} must be in HH:MM format") from exc


def _parse_iso_date(value: str | None, *, field_name: str) -> date:
    """Parse an ISO date string."""
    if not value:
        raise ValueError(f"{field_name} is required")
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"{field_name} must be in YYYY-MM-DD format") from exc


def _advance_cadence(base_date: date, cadence: str) -> date:
    """Advance a date by the given cadence."""
    if cadence == "daily":
        return base_date + timedelta(days=1)
    elif cadence == "weekly":
        return base_date + timedelta(weeks=1)
    elif cadence == "biweekly":
        return base_date + timedelta(weeks=2)
    elif cadence == "monthly":
        # Approximate month advancement
        return base_date + timedelta(days=30)
    else:
        raise ValueError(f"Unknown cadence: {cadence}")


def _combine_local_to_utc(local_date: date, local_time: time, timezone_name: str) -> datetime:
    """Combine local date/time with timezone to get UTC datetime."""
    local_tz = ZoneInfo(timezone_name)
    local_dt = datetime.combine(local_date, local_time, tzinfo=local_tz)
    return local_dt.astimezone(timezone.utc)


async def execute_transfer_run(
    *,
    user_id: str,
    actor_user_id: str,
    from_account_id: str,
    to_account_id: str,
    amount_cents: int,
    memo: str | None,
    transfer_date: str,
    transfer_plan_id: str,
    enforce_user_ownership: bool = True,
) -> TransferResult:
    """Execute a transfer run for a transfer plan."""
    # This is essentially the same as create_transfer_for_user but with transfer_plan_id
    # For now, we'll reuse the existing logic but add the transfer_plan_id to the transfer
    if from_account_id == to_account_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot transfer to the same account.",
        )

    amount_cents_check = amount_to_cents(amount_cents / 100)  # Convert back to dollars then to cents to validate
    if amount_cents_check != amount_cents:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Transfer amount must be greater than zero.",
        )

    # Fetch accounts for validation (non-mutating reads)
    from_account = await _get_account(from_account_id)
    to_account = await _get_account(to_account_id)

    if enforce_user_ownership and from_account["user_id"] != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to transfer from this account.",
        )

    if from_account["status"] != "open" or to_account["status"] != "open":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Both accounts must be open.",
        )

    if from_account["available_balance_cents"] < amount_cents:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Insufficient balance.",
        )

    # Ensure ledger accounts exist for both accounts (safety check)
    await ensure_ledger_accounts_for_transfer(from_account, to_account)

    # Call transactional RPC: all mutations happen atomically in Postgres
    # The RPC uses FOR UPDATE to lock both accounts, validates state, and performs
    # all updates (accounts, transfer, ledger_journals, ledger_postings, transactions, notifications)
    # in one transaction
    try:
        result = await supabase_client.rpc(
            "submit_internal_transfer",
            {
                "p_user_id": user_id,
                "p_from_account_id": from_account_id,
                "p_to_account_id": to_account_id,
                "p_amount_cents": amount_cents,
                "p_transfer_date": transfer_date,
                "p_memo": memo,
            },
        )
    except HTTPException as exc:
        # RPC errors should propagate with appropriate HTTP status codes
        if "Insufficient available funds" in str(exc.detail):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Insufficient balance.",
            ) from exc
        elif any(msg in str(exc.detail) for msg in ["not found", "open", "different accounts"]):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(exc.detail),
            ) from exc
        raise

    # Add transfer_plan_id to the created transfer
    if isinstance(result, list) and result:
        transfer_id = result[0].get("id")
        if transfer_id:
            await supabase_client.update_rows(
                "transfers",
                {"transfer_plan_id": transfer_plan_id},
                filters={"id": f"eq.{transfer_id}"},
            )

    # Result contains: id, status, submitted_at from the RPC
    # Note: result may be a list with one row (Supabase RPC returns rows)
    if isinstance(result, list):
        result = result[0] if result else {}
    
    return TransferResult(
        id=result.get("id"),
        status="COMPLETED",
        submittedAt=result.get("submitted_at"),
    )


def _format_error_detail(detail: str | dict) -> str:
    """Format error detail for storage."""
    if isinstance(detail, dict):
        return detail.get("message", str(detail))
    return str(detail)