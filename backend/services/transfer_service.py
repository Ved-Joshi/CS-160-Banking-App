from __future__ import annotations

from datetime import date, datetime, time, timezone, timedelta
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status

from schemas.banking import (
    CreateTransferIn,
    TransferPlan,
    TransferResult,
    TransferSubmissionResult,
)
from utils.supabase import SupabaseUser, amount_to_cents, cents_to_amount, supabase_client

STALE_PROCESSING_TIMEOUT_MINUTES = 10


def _is_admin(current_user: SupabaseUser) -> bool:
    roles = current_user.app_metadata.get("roles") or current_user.user_metadata.get("roles") or []
    return isinstance(roles, list) and "admin" in roles


def _normalize_cadence(value: str) -> str:
    return {
        "Once": "once",
        "Daily": "daily",
        "Weekly": "weekly",
        "Biweekly": "biweekly",
        "Monthly": "monthly",
        "once": "once",
        "daily": "daily",
        "weekly": "weekly",
        "biweekly": "biweekly",
        "monthly": "monthly",
    }.get(value, "once")


def _map_cadence(value: str) -> str:
    return {
        "once": "Once",
        "daily": "Daily",
        "weekly": "Weekly",
        "biweekly": "Biweekly",
        "monthly": "Monthly",
    }.get(value, "Once")


def _map_plan_status(value: str) -> str:
    return {
        "scheduled": "SCHEDULED",
        "processing": "PROCESSING",
        "completed": "COMPLETED",
        "cancelled": "CANCELLED",
    }.get(value, "SCHEDULED")


def _map_transfer_status(value: str) -> str:
    return {
        "pending": "PENDING",
        "completed": "COMPLETED",
        "failed": "FAILED",
        "cancelled": "FAILED",
    }.get(value, "PENDING")


def _parse_iso_date(value: str | None, *, field_name: str) -> date:
    if not value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{field_name} is required.",
        )
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{field_name} must be in YYYY-MM-DD format.",
        ) from exc


def _parse_local_time(value: str | None, *, field_name: str) -> time:
    if not value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{field_name} is required.",
        )
    for fmt in ("%H:%M", "%H:%M:%S"):
        try:
            parsed = datetime.strptime(value, fmt).time()
            return parsed.replace(second=0, microsecond=0)
        except ValueError:
            continue
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=f"{field_name} must be in HH:MM format.",
    )


def _validate_timezone(value: str | None) -> str:
    tz_name = (value or "").strip()
    if not tz_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="timezone is required.")
    try:
        ZoneInfo(tz_name)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid timezone.") from exc
    return tz_name


def _combine_local_to_utc(day: date, run_time: time, timezone_name: str) -> datetime:
    tz = ZoneInfo(timezone_name)
    local_dt = datetime.combine(day, run_time, tzinfo=tz)
    return local_dt.astimezone(timezone.utc)


def _add_months(day: date, months: int) -> date:
    year = day.year + (day.month - 1 + months) // 12
    month = (day.month - 1 + months) % 12 + 1
    if month == 12:
        next_month = date(year + 1, 1, 1)
    else:
        next_month = date(year, month + 1, 1)
    last_day = (next_month - timedelta(days=1)).day
    return date(year, month, min(day.day, last_day))


def _advance_cadence(day: date, cadence: str) -> date:
    if cadence == "daily":
        return day + timedelta(days=1)
    if cadence == "weekly":
        return day + timedelta(days=7)
    if cadence == "biweekly":
        return day + timedelta(days=14)
    if cadence == "monthly":
        return _add_months(day, 1)
    return day


def _format_error_detail(detail: object) -> str:
    if isinstance(detail, str):
        return detail
    if isinstance(detail, dict):
        message = detail.get("message")
        if isinstance(message, str) and message:
            return message
        return str(detail)
    if isinstance(detail, list):
        return ", ".join(str(item) for item in detail)
    return "Transfer failed."


async def _get_user_profile(user_id: str) -> dict:
    rows = await supabase_client.select_rows("profiles", filters={"id": f"eq.{user_id}"}, limit=1)
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found.")
    return rows[0]


async def _get_account(account_id: str) -> dict:
    rows = await supabase_client.select_rows(
        "accounts",
        filters={"id": f"eq.{account_id}"},
        limit=1,
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found.")
    return rows[0]


def _map_transfer_result(row: dict) -> TransferResult:
    return TransferResult(
        id=row["id"],
        status=_map_transfer_status(row.get("status", "pending")),
        submittedAt=row.get("submitted_at") or datetime.now(timezone.utc).isoformat(),
    )


def _map_transfer_plan(row: dict) -> TransferPlan:
    return TransferPlan(
        id=row["id"],
        fromAccountId=row["from_account_id"],
        toAccountId=row["to_account_id"],
        amount=cents_to_amount(row["amount_cents"]),
        memo=row.get("memo"),
        cadence=_map_cadence(row.get("cadence", "once")),
        startDate=row["start_date"],
        runTime=(row.get("run_time") or "00:00:00")[:5],
        timezone=row.get("timezone") or "UTC",
        endDate=row.get("end_date"),
        nextRunAt=row.get("next_run_at"),
        lastRunAt=row.get("last_run_at"),
        lastFailureReason=row.get("last_failure_reason"),
        status=_map_plan_status(row.get("status", "scheduled")),
        createdAt=row.get("created_at") or "",
        updatedAt=row.get("updated_at") or "",
    )


def _compute_next_run_at(
    *,
    cadence: str,
    start_date: date,
    run_time: time,
    timezone_name: str,
    reference_utc: datetime,
) -> datetime | None:
    candidate_date = start_date
    candidate_utc = _combine_local_to_utc(candidate_date, run_time, timezone_name)

    if cadence == "once":
        return candidate_utc if candidate_utc > reference_utc else None

    while candidate_utc <= reference_utc:
        candidate_date = _advance_cadence(candidate_date, cadence)
        candidate_utc = _combine_local_to_utc(candidate_date, run_time, timezone_name)
    return candidate_utc


async def execute_transfer_run(
    *,
    user_id: str,
    actor_user_id: str,
    from_account_id: str,
    to_account_id: str,
    amount_cents: int,
    memo: str | None,
    transfer_date: str,
    transfer_plan_id: str | None = None,
    enforce_user_ownership: bool = True,
) -> dict:
    if from_account_id == to_account_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot transfer to the same account.",
        )
    if amount_cents <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Transfer amount must be greater than zero.",
        )

    from_account = await _get_account(from_account_id)
    to_account = await _get_account(to_account_id)

    if enforce_user_ownership:
        if from_account["user_id"] != user_id or to_account["user_id"] != user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized to transfer between these accounts.",
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

    now_iso = datetime.now(timezone.utc).isoformat()
    transfer = await supabase_client.insert_row(
        "transfers",
        {
            "user_id": user_id,
            "from_account_id": from_account_id,
            "to_account_id": to_account_id,
            "amount_cents": amount_cents,
            "memo": memo,
            "transfer_date": transfer_date,
            "status": "completed",
            "completed_at": now_iso,
            "transfer_plan_id": transfer_plan_id,
        },
    )

    await supabase_client.update_rows(
        "accounts",
        {
            "available_balance_cents": from_account["available_balance_cents"] - amount_cents,
            "current_balance_cents": from_account["current_balance_cents"] - amount_cents,
        },
        filters={"id": f"eq.{from_account_id}"},
    )

    await supabase_client.update_rows(
        "accounts",
        {
            "available_balance_cents": to_account["available_balance_cents"] + amount_cents,
            "current_balance_cents": to_account["current_balance_cents"] + amount_cents,
        },
        filters={"id": f"eq.{to_account_id}"},
    )

    journal = await supabase_client.insert_row(
        "ledger_journals",
        {
            "event_type": "transfer",
            "reference_type": "transfer",
            "reference_id": transfer["id"],
            "description": memo or "Internal transfer",
            "created_by": actor_user_id,
        },
    )

    await supabase_client.insert_row(
        "transactions",
        {
            "user_id": user_id,
            "account_id": from_account_id,
            "journal_id": journal["id"],
            "type": "transfer",
            "direction": "out",
            "amount_cents": amount_cents,
            "description": memo or "Transfer out",
            "status": "posted",
            "posted_at": now_iso,
            "transfer_id": transfer["id"],
        },
    )

    await supabase_client.insert_row(
        "transactions",
        {
            "user_id": user_id,
            "account_id": to_account_id,
            "journal_id": journal["id"],
            "type": "transfer",
            "direction": "in",
            "amount_cents": amount_cents,
            "description": memo or "Transfer in",
            "status": "posted",
            "posted_at": now_iso,
            "transfer_id": transfer["id"],
        },
    )

    return transfer


async def create_transfer_for_user(
    *,
    current_user: SupabaseUser,
    payload: CreateTransferIn,
    parsed_transfer_date: str,
) -> TransferSubmissionResult:
    is_admin = _is_admin(current_user)
    amount_cents = amount_to_cents(payload.amount)

    if payload.scheduleMode == "NOW":
        transfer = await execute_transfer_run(
            user_id=current_user.id,
            actor_user_id=current_user.id,
            from_account_id=payload.fromAccountId,
            to_account_id=payload.toAccountId,
            amount_cents=amount_cents,
            memo=payload.memo,
            transfer_date=parsed_transfer_date,
            enforce_user_ownership=not is_admin,
        )
        return TransferSubmissionResult(mode="NOW", transfer=_map_transfer_result(transfer))

    cadence = _normalize_cadence(payload.cadence or "")
    if cadence not in {"once", "daily", "weekly", "biweekly", "monthly"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="cadence is required for scheduled transfers.")

    start_date = _parse_iso_date(payload.startDate or payload.transferDate, field_name="startDate")
    run_time = _parse_local_time(payload.runTime, field_name="runTime")
    end_date = _parse_iso_date(payload.endDate, field_name="endDate") if payload.endDate else None
    if end_date and end_date < start_date:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="endDate must be on or after startDate.")

    profile = await _get_user_profile(current_user.id)
    timezone_name = _validate_timezone(payload.timezone or profile.get("timezone"))

    from_account = await _get_account(payload.fromAccountId)
    to_account = await _get_account(payload.toAccountId)
    if not is_admin and (from_account["user_id"] != current_user.id or to_account["user_id"] != current_user.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to transfer between these accounts.",
        )
    if from_account["status"] != "open" or to_account["status"] != "open":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Both accounts must be open.")

    now_utc = datetime.now(timezone.utc)
    first_run_at = _combine_local_to_utc(start_date, run_time, timezone_name)
    if first_run_at <= now_utc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="First scheduled run must be in the future.",
        )

    created = await supabase_client.insert_row(
        "transfer_plans",
        {
            "user_id": current_user.id,
            "from_account_id": payload.fromAccountId,
            "to_account_id": payload.toAccountId,
            "amount_cents": amount_cents,
            "memo": payload.memo,
            "cadence": cadence,
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat() if end_date else None,
            "run_time": run_time.strftime("%H:%M:%S"),
            "timezone": timezone_name,
            "status": "scheduled",
            "next_run_at": first_run_at.isoformat(),
        },
    )
    return TransferSubmissionResult(mode="SCHEDULED", plan=_map_transfer_plan(created))


async def list_transfer_plans_for_user(current_user: SupabaseUser) -> list[TransferPlan]:
    rows = await supabase_client.select_rows(
        "transfer_plans",
        filters={
            "user_id": f"eq.{current_user.id}",
            "status": "in.(scheduled,processing)",
        },
        order="created_at.desc",
    )
    return [_map_transfer_plan(row) for row in rows]


async def cancel_transfer_plan_for_user(plan_id: str, current_user: SupabaseUser) -> TransferPlan:
    rows = await supabase_client.select_rows(
        "transfer_plans",
        filters={"id": f"eq.{plan_id}", "user_id": f"eq.{current_user.id}"},
        limit=1,
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transfer plan not found.")
    plan = rows[0]
    if plan.get("status") in {"completed", "cancelled"}:
        return _map_transfer_plan(plan)

    updated_rows = await supabase_client.update_rows(
        "transfer_plans",
        {
            "status": "cancelled",
            "next_run_at": None,
        },
        filters={"id": f"eq.{plan_id}", "user_id": f"eq.{current_user.id}"},
    )
    if not updated_rows:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Unable to cancel transfer plan.")
    return _map_transfer_plan(updated_rows[0])


async def process_due_transfer_plans(*, batch_size: int = 50) -> dict[str, int]:
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
