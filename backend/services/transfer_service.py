from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status

from config import settings
from schemas.banking import (
    CreateExternalAccountIn,
    CompleteExternalLinkIn,
    CreateExternalTransferIn,
    CreateMemberTransferIn,
    MemberTransferRecipient,
    TransferResult,
)
from services.external_linking_provider import get_external_linking_provider
from services.stripe_sandbox_service import (
    create_financial_connections_session,
    create_stripe_customer_for_linking,
    get_financial_connections_account,
)
from utils.banking_numbers import validate_account_number, validate_routing_number
from utils.supabase import SupabaseUser, amount_to_cents, supabase_client
from services.ledger_service import ensure_ledger_accounts_for_transfer

STALE_PROCESSING_TIMEOUT_MINUTES = 10
EXTERNAL_SETTLEMENT_DELAY_SECONDS = 15
SCHEDULE_MIN_LEAD_SECONDS = 60


def _validate_email(value: str) -> str:
    normalized = value.strip().lower()
    if "@" not in normalized or normalized.startswith("@") or normalized.endswith("@"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Recipient email must be a valid email address.")
    local_part, _, domain = normalized.partition("@")
    if not local_part or "." not in domain or domain.startswith(".") or domain.endswith("."):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Recipient email must be a valid email address.")
    return normalized


def _validate_bank_name(value: str) -> str:
    normalized = " ".join(value.strip().split())
    if len(normalized) < 2 or len(normalized) > 80:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bank name must be between 2 and 80 characters.")
    if not any(char.isalpha() for char in normalized):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bank name must contain letters.")
    for char in normalized:
        if not (char.isalnum() or char in {" ", ".", "&", "-", "'"}):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bank name contains unsupported characters.")
    return normalized


def _validate_display_name(value: str, *, field_name: str) -> str:
    normalized = " ".join(value.strip().split())
    if len(normalized) < 2 or len(normalized) > 80:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{field_name} must be between 2 and 80 characters.",
        )
    return normalized


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


async def _get_owned_account(account_id: str, user_id: str) -> dict:
    account = await _get_account(account_id)
    if account.get("user_id") != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to use this account.")
    return account


async def _get_profile(user_id: str) -> dict | None:
    rows = await supabase_client.select_rows("profiles", filters={"id": f"eq.{user_id}"}, limit=1)
    return rows[0] if rows else None


def _parse_iso_date(value: str | None, *, field_name: str) -> date:
    if not value:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{field_name} is required.")
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{field_name} must be in YYYY-MM-DD format.",
        ) from exc


def _parse_local_time(value: str | None, *, field_name: str) -> time:
    if not value:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{field_name} is required.")
    candidate = value.strip()
    for fmt in ("%H:%M", "%H:%M:%S"):
        try:
            return datetime.strptime(candidate, fmt).time()
        except ValueError:
            continue
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=f"{field_name} must be in HH:MM format.",
    )


def _advance_cadence(base_date: date, cadence: str) -> date:
    if cadence == "daily":
        return base_date + timedelta(days=1)
    if cadence == "weekly":
        return base_date + timedelta(weeks=1)
    if cadence == "biweekly":
        return base_date + timedelta(weeks=2)
    if cadence == "monthly":
        if base_date.month == 12:
            year = base_date.year + 1
            month = 1
        else:
            year = base_date.year
            month = base_date.month + 1
        first_of_following = date(year + (1 if month == 12 else 0), 1 if month == 12 else month + 1, 1)
        last_of_target = first_of_following - timedelta(days=1)
        return date(year, month, min(base_date.day, last_of_target.day))
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported cadence.")


def _roll_forward_to_today_or_later(base_date: date, cadence: str, today: date) -> date:
    cursor = base_date
    safety_counter = 0
    while cursor < today and safety_counter < 400:
        cursor = _advance_cadence(cursor, cadence)
        safety_counter += 1
    return cursor


def _combine_local_to_utc(local_date: date, local_time: time, timezone_name: str) -> datetime:
    try:
        local_zone = ZoneInfo(timezone_name)
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid timezone.") from exc
    local_dt = datetime.combine(local_date, local_time, tzinfo=local_zone)
    return local_dt.astimezone(timezone.utc)


def _normalize_cadence(value: str | None) -> str:
    normalized = (value or "Once").strip().lower()
    if normalized not in {"once", "daily", "weekly", "biweekly", "monthly"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported cadence.")
    return normalized


def _local_today(timezone_name: str) -> date:
    return datetime.now(ZoneInfo(timezone_name)).date()


async def _get_user_timezone_name(current_user: SupabaseUser) -> str:
    profile = await _get_profile(current_user.id)
    return (profile or {}).get("timezone") or "UTC"


async def _validate_immediate_transfer_date(transfer_date: str | None) -> str:
    parsed = _parse_iso_date(transfer_date, field_name="transferDate")
    if parsed != date.today():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only same-day immediate transfers are supported.",
        )
    return parsed.isoformat()


async def _validate_schedule_payload(
    *,
    current_user: SupabaseUser,
    cadence_input: str | None,
    start_date_input: str | None,
    run_time_input: str | None,
    end_date_input: str | None,
    timezone_input: str | None,
) -> tuple[str, str, str, str | None, str]:
    timezone_name = timezone_input or await _get_user_timezone_name(current_user)
    start_date = _parse_iso_date(start_date_input, field_name="startDate")
    run_time = _parse_local_time(run_time_input, field_name="runTime")
    end_date = _parse_iso_date(end_date_input, field_name="endDate") if end_date_input else None
    cadence = _normalize_cadence(cadence_input)

    if end_date and end_date < start_date:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="End date must be on or after start date.")

    local_now = datetime.now(ZoneInfo(timezone_name))
    scheduled_dt = datetime.combine(start_date, run_time, tzinfo=ZoneInfo(timezone_name))
    min_allowed = local_now + timedelta(seconds=SCHEDULE_MIN_LEAD_SECONDS)
    if scheduled_dt <= min_allowed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Scheduled transfers must be at least 1 minute in the future.",
        )

    return (
        cadence,
        start_date.isoformat(),
        run_time.strftime("%H:%M"),
        end_date.isoformat() if end_date else None,
        timezone_name,
    )


async def create_transfer_for_user(
    current_user: SupabaseUser,
    from_account_id: str,
    to_account_id: str,
    amount: float,
    memo: str | None,
    transfer_date: str,
) -> TransferResult:
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

    from_account = await _get_account(from_account_id)
    to_account = await _get_account(to_account_id)

    if not _is_admin(current_user) and from_account["user_id"] != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to transfer from this account.",
        )
    if not _is_admin(current_user) and to_account["user_id"] != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Self transfers can only be made between your own accounts.",
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
        if "Insufficient available funds" in str(exc.detail):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Insufficient balance.",
            ) from exc
        if any(msg in str(exc.detail) for msg in ["not found", "open", "different accounts"]):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(exc.detail),
            ) from exc
        raise

    if isinstance(result, list):
        result = result[0] if result else {}

    return TransferResult(
        id=result.get("id"),
        status="COMPLETED",
        submittedAt=result.get("submitted_at"),
    )


async def resolve_member_recipient_for_user(current_user: SupabaseUser, recipient_email: str) -> MemberTransferRecipient:
    normalized = _validate_email(recipient_email)

    rows = await supabase_client.select_rows(
        "profiles",
        filters={"email": f"eq.{normalized}"},
        limit=1,
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recipient not found.")

    profile = rows[0]
    if profile["id"] == current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Choose another member.")

    account_rows = await supabase_client.select_rows(
        "accounts",
        filters={
            "user_id": f"eq.{profile['id']}",
            "account_type": "eq.checking",
            "status": "eq.open",
            "is_default_internal_receive": "eq.true",
        },
        limit=1,
    )
    if not account_rows:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Recipient does not have an eligible default checking account.",
        )

    account = account_rows[0]
    display_name = " ".join(
        part for part in [profile.get("first_name"), profile.get("last_name")] if isinstance(part, str) and part.strip()
    ).strip() or profile.get("email") or "Member"

    return MemberTransferRecipient(
        userId=profile["id"],
        displayName=display_name,
        email=profile.get("email") or normalized,
        defaultCheckingAccountMasked=f"...{account.get('account_last4') or '----'}",
    )


async def create_member_transfer_for_user(current_user: SupabaseUser, payload: CreateMemberTransferIn) -> dict:
    recipient = await resolve_member_recipient_for_user(current_user, payload.recipientEmail)
    from_account = await _get_owned_account(payload.fromAccountId, current_user.id)
    if from_account.get("account_type") != "checking":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Member transfers require a checking account.")
    if from_account.get("status") != "open":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Source account must be open.")

    amount_cents = amount_to_cents(payload.amount)
    if amount_cents <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Transfer amount must be greater than zero.")
    if from_account.get("available_balance_cents", 0) < amount_cents:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Insufficient available funds.")

    if payload.scheduleMode == "SCHEDULED":
        cadence, start_date, run_time, end_date, timezone_name = await _validate_schedule_payload(
            current_user=current_user,
            cadence_input=payload.cadence,
            start_date_input=payload.startDate,
            run_time_input=payload.runTime,
            end_date_input=payload.endDate,
            timezone_input=payload.timezone,
        )
        next_run_at = _combine_local_to_utc(
            _parse_iso_date(start_date, field_name="startDate"),
            _parse_local_time(run_time, field_name="runTime"),
            timezone_name,
        )
        plan = await supabase_client.insert_row(
            "member_transfer_plans",
            {
                "user_id": current_user.id,
                "from_account_id": payload.fromAccountId,
                "recipient_user_id": recipient.userId,
                "recipient_handle": recipient.email,
                "amount_cents": amount_cents,
                "memo": payload.memo,
                "cadence": cadence,
                "start_date": start_date,
                "end_date": end_date,
                "run_time": run_time,
                "timezone": timezone_name,
                "next_run_at": next_run_at.isoformat(),
                "status": "scheduled",
            },
        )
        return {"mode": "SCHEDULED", "plan": plan, "recipient": recipient.model_dump()}

    transfer_date = await _validate_immediate_transfer_date(payload.transferDate or date.today().isoformat())
    result = await supabase_client.rpc(
        "submit_member_transfer",
        {
            "p_user_id": current_user.id,
            "p_from_account_id": payload.fromAccountId,
            "p_recipient_user_id": recipient.userId,
            "p_amount_cents": amount_cents,
            "p_transfer_date": transfer_date,
            "p_memo": payload.memo,
            "p_member_transfer_plan_id": None,
        },
    )
    row = result[0] if isinstance(result, list) and result else result or {}
    created_rows = await supabase_client.select_rows(
        "member_transfers",
        filters={"id": f"eq.{row.get('id')}"},
        limit=1,
    )
    return {"mode": "NOW", "transfer": created_rows[0] if created_rows else row, "recipient": recipient.model_dump()}


async def list_member_transfer_plans_for_user(user_id: str) -> list[dict]:
    rows = await supabase_client.select_rows(
        "member_transfer_plans",
        filters={"user_id": f"eq.{user_id}"},
        order="created_at.desc",
    )
    if not rows:
        return []
    recipient_ids = {row["recipient_user_id"] for row in rows if row.get("recipient_user_id")}
    profiles = await supabase_client.select_rows(
        "profiles",
        filters={"id": f"in.({','.join(recipient_ids)})"} if recipient_ids else None,
    ) if recipient_ids else []
    profile_map = {row["id"]: row for row in profiles}
    for row in rows:
        profile = profile_map.get(row.get("recipient_user_id"), {})
        row["recipient_display_name"] = " ".join(
            part for part in [profile.get("first_name"), profile.get("last_name")] if isinstance(part, str) and part.strip()
        ).strip() or profile.get("email") or row.get("recipient_handle") or "Member"
    return rows


async def cancel_member_transfer_plan_for_user(user_id: str, plan_id: str) -> dict:
    rows = await supabase_client.update_rows(
        "member_transfer_plans",
        {
            "status": "cancelled",
            "next_run_at": None,
        },
        filters={
            "id": f"eq.{plan_id}",
            "user_id": f"eq.{user_id}",
            "status": "eq.scheduled",
        },
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scheduled member transfer not found.")
    plans = await list_member_transfer_plans_for_user(user_id)
    for plan in plans:
        if plan["id"] == rows[0]["id"]:
            return plan
    return rows[0]


async def update_member_transfer_plan_for_user(user_id: str, plan_id: str, payload: dict) -> dict:
    rows = await supabase_client.select_rows(
        "member_transfer_plans",
        filters={"id": f"eq.{plan_id}", "user_id": f"eq.{user_id}"},
        limit=1,
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scheduled member transfer not found.")
    plan = rows[0]
    if plan.get("status") != "scheduled":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only scheduled transfers can be edited.")

    cadence = _normalize_cadence(payload.get("cadence") or plan.get("cadence"))
    timezone_name = (payload.get("timezone") or plan.get("timezone") or "UTC").strip() or "UTC"
    start_date = _parse_iso_date(payload.get("startDate") or plan.get("start_date"), field_name="startDate")
    run_time = _parse_local_time(payload.get("runTime") or plan.get("run_time"), field_name="runTime")
    end_date_value = payload.get("endDate")
    end_date = _parse_iso_date(end_date_value, field_name="endDate") if end_date_value else (
        _parse_iso_date(plan.get("end_date"), field_name="endDate") if plan.get("end_date") else None
    )
    if end_date and end_date < start_date:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="End date must be on or after start date.")

    next_run_at = _combine_local_to_utc(start_date, run_time, timezone_name)
    min_allowed_utc = datetime.now(timezone.utc) + timedelta(seconds=SCHEDULE_MIN_LEAD_SECONDS)
    if next_run_at <= min_allowed_utc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Scheduled transfers must be at least 1 minute in the future.",
        )

    amount = payload.get("amount")
    amount_cents = amount_to_cents(amount) if amount is not None else int(plan.get("amount_cents", 0))
    if amount_cents <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Transfer amount must be greater than zero.")

    updated_rows = await supabase_client.update_rows(
        "member_transfer_plans",
        {
            "amount_cents": amount_cents,
            "memo": payload.get("memo") if payload.get("memo") is not None else plan.get("memo"),
            "cadence": cadence,
            "start_date": start_date.isoformat(),
            "run_time": run_time.strftime("%H:%M"),
            "end_date": end_date.isoformat() if end_date else None,
            "timezone": timezone_name,
            "next_run_at": next_run_at.isoformat(),
            "last_failure_reason": None,
        },
        filters={"id": f"eq.{plan_id}", "user_id": f"eq.{user_id}", "status": "eq.scheduled"},
    )
    if not updated_rows:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Unable to update scheduled member transfer.")
    plans = await list_member_transfer_plans_for_user(user_id)
    for item in plans:
        if item["id"] == updated_rows[0]["id"]:
            return item
    return updated_rows[0]


async def retry_member_transfer_plan_for_user(user_id: str, plan_id: str) -> dict:
    rows = await supabase_client.select_rows(
        "member_transfer_plans",
        filters={"id": f"eq.{plan_id}", "user_id": f"eq.{user_id}"},
        limit=1,
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scheduled member transfer not found.")
    plan = rows[0]
    if plan.get("status") != "scheduled":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only scheduled transfers can be retried.")

    timezone_name = (plan.get("timezone") or "UTC").strip() or "UTC"
    run_time = _parse_local_time(plan.get("run_time"), field_name="runTime")
    local_today = datetime.now(ZoneInfo(timezone_name)).date()
    cadence = plan["cadence"]
    failure_reason = None

    try:
        await supabase_client.rpc(
            "submit_member_transfer",
            {
                "p_user_id": plan["user_id"],
                "p_from_account_id": plan["from_account_id"],
                "p_recipient_user_id": plan["recipient_user_id"],
                "p_amount_cents": plan["amount_cents"],
                "p_transfer_date": local_today.isoformat(),
                "p_memo": plan.get("memo"),
                "p_member_transfer_plan_id": plan["id"],
            },
        )
    except HTTPException as exc:
        failure_reason = str(exc.detail)

    if cadence == "once":
        status_value = "completed" if not failure_reason else "scheduled"
        next_run_at = None if not failure_reason else _combine_local_to_utc(local_today, run_time, timezone_name).isoformat()
    else:
        next_date = _advance_cadence(local_today, cadence) if not failure_reason else local_today
        status_value = "scheduled"
        next_run_at = _combine_local_to_utc(next_date, run_time, timezone_name).isoformat()

    await supabase_client.update_rows(
        "member_transfer_plans",
        {
            "status": status_value,
            "next_run_at": next_run_at,
            "last_run_at": datetime.now(timezone.utc).isoformat(),
            "last_failure_reason": failure_reason,
        },
        filters={"id": f"eq.{plan_id}", "user_id": f"eq.{user_id}"},
    )
    plans = await list_member_transfer_plans_for_user(user_id)
    for item in plans:
        if item["id"] == plan_id:
            return item
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scheduled member transfer not found.")


async def process_due_member_transfer_plans(*, batch_size: int = 50) -> dict[str, int]:
    now_utc = datetime.now(timezone.utc)
    stale_cutoff = now_utc - timedelta(minutes=STALE_PROCESSING_TIMEOUT_MINUTES)

    stale_rows = await supabase_client.select_rows(
        "member_transfer_plans",
        select="id",
        filters={
            "status": "eq.processing",
            "updated_at": f"lte.{stale_cutoff.isoformat()}",
        },
        limit=batch_size,
    )
    reclaimed = 0
    for row in stale_rows:
        reset_rows = await supabase_client.update_rows(
            "member_transfer_plans",
            {"status": "scheduled"},
            filters={"id": f"eq.{row['id']}", "status": "eq.processing"},
        )
        if reset_rows:
            reclaimed += 1

    due_rows = await supabase_client.select_rows(
        "member_transfer_plans",
        filters={"status": "eq.scheduled", "next_run_at": f"lte.{now_utc.isoformat()}"},
        order="next_run_at.asc",
        limit=batch_size,
    )

    processed = 0
    succeeded = 0
    failed = 0
    timezone_cache: dict[str, str] = {}
    for row in due_rows:
        claimed = await supabase_client.update_rows(
            "member_transfer_plans",
            {"status": "processing"},
            filters={"id": f"eq.{row['id']}", "status": "eq.scheduled"},
        )
        if not claimed:
            continue

        plan = claimed[0]
        processed += 1
        cadence = plan["cadence"]
        timezone_name = timezone_cache.get(plan["user_id"])
        if timezone_name is None:
            timezone_name = (plan.get("timezone") or "UTC").strip() or "UTC"
            timezone_cache[plan["user_id"]] = timezone_name
        run_time = _parse_local_time(plan.get("run_time"), field_name="runTime")
        next_run_at = datetime.fromisoformat(plan["next_run_at"].replace("Z", "+00:00"))
        local_run_date = next_run_at.astimezone(ZoneInfo(timezone_name)).date()
        local_today = now_utc.astimezone(ZoneInfo(timezone_name)).date()
        end_date = _parse_iso_date(plan["end_date"], field_name="endDate") if plan.get("end_date") else None
        last_failure_reason = None

        try:
            result = await supabase_client.rpc(
                "submit_member_transfer",
                {
                    "p_user_id": plan["user_id"],
                    "p_from_account_id": plan["from_account_id"],
                    "p_recipient_user_id": plan["recipient_user_id"],
                    "p_amount_cents": plan["amount_cents"],
                    "p_transfer_date": local_run_date.isoformat(),
                    "p_memo": plan.get("memo"),
                    "p_member_transfer_plan_id": plan["id"],
                },
            )
            if not result:
                raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Transfer execution failed.")
            succeeded += 1
        except HTTPException as exc:
            failed += 1
            last_failure_reason = str(exc.detail)
            await supabase_client.insert_row(
                "member_transfers",
                {
                    "user_id": plan["user_id"],
                    "from_account_id": plan["from_account_id"],
                    "recipient_user_id": plan["recipient_user_id"],
                    "amount_cents": plan["amount_cents"],
                    "memo": plan.get("memo"),
                    "transfer_date": local_run_date.isoformat(),
                    "status": "failed",
                    "failure_reason": last_failure_reason,
                    "member_transfer_plan_id": plan["id"],
                },
            )

        if cadence == "once":
            if last_failure_reason:
                retry_date = local_run_date if local_run_date >= local_today else local_today
                await supabase_client.update_rows(
                    "member_transfer_plans",
                    {
                        "status": "scheduled",
                        "last_run_at": now_utc.isoformat(),
                        "next_run_at": _combine_local_to_utc(retry_date, run_time, timezone_name).isoformat(),
                        "last_failure_reason": last_failure_reason,
                    },
                    filters={"id": f"eq.{plan['id']}"},
                )
                continue
            await supabase_client.update_rows(
                "member_transfer_plans",
                {
                    "status": "completed",
                    "last_run_at": now_utc.isoformat(),
                    "next_run_at": None,
                    "last_failure_reason": None,
                },
                filters={"id": f"eq.{plan['id']}"},
            )
            continue

        if last_failure_reason:
            if local_run_date == local_today:
                retry_date = local_run_date
            elif local_run_date < local_today:
                retry_date = _roll_forward_to_today_or_later(local_run_date, cadence, local_today)
            else:
                retry_date = local_run_date
            await supabase_client.update_rows(
                "member_transfer_plans",
                {
                    "status": "scheduled",
                    "last_run_at": now_utc.isoformat(),
                    "next_run_at": _combine_local_to_utc(retry_date, run_time, timezone_name).isoformat(),
                    "last_failure_reason": last_failure_reason,
                },
                filters={"id": f"eq.{plan['id']}"},
            )
            continue

        success_base_date = local_run_date if local_run_date >= local_today else local_today
        following_date = _advance_cadence(success_base_date, cadence)
        if end_date and following_date > end_date:
            await supabase_client.update_rows(
                "member_transfer_plans",
                {
                    "status": "completed",
                    "last_run_at": now_utc.isoformat(),
                    "next_run_at": None,
                    "last_failure_reason": None,
                },
                filters={"id": f"eq.{plan['id']}"},
            )
            continue

        following_run_at = _combine_local_to_utc(following_date, run_time, timezone_name)
        await supabase_client.update_rows(
            "member_transfer_plans",
            {
                "status": "scheduled",
                "last_run_at": now_utc.isoformat(),
                "next_run_at": following_run_at.isoformat(),
                "last_failure_reason": None,
            },
            filters={"id": f"eq.{plan['id']}"},
        )

    return {"reclaimed": reclaimed, "processed": processed, "succeeded": succeeded, "failed": failed}


async def create_external_account_for_user(current_user: SupabaseUser, payload: CreateExternalAccountIn) -> dict:
    routing_number = validate_routing_number(payload.routingNumber)
    account_number = validate_account_number(payload.accountNumber, field_name="Account number")
    confirm_account_number = validate_account_number(payload.confirmAccountNumber, field_name="Confirm account number")
    bank_name = _validate_bank_name(payload.bankName)
    nickname = _validate_display_name(payload.nickname, field_name="Nickname")
    if account_number != confirm_account_number:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Account numbers must match.")
    if account_number == routing_number:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Account number cannot match the routing number.",
        )
    masked = f"...{account_number[-4:]}"
    duplicate_rows = await supabase_client.select_rows(
        "external_accounts",
        filters={
            "user_id": f"eq.{current_user.id}",
            "routing_number": f"eq.{routing_number}",
            "masked_account_number": f"eq.{masked}",
            "is_active": "eq.true",
        },
        limit=1,
    )
    if duplicate_rows:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This external account is already linked.",
        )

    provider = get_external_linking_provider(settings.EXTERNAL_ACCOUNT_PROVIDER)
    linking_result = await provider.link_external_account(
        user_id=current_user.id,
        bank_name=bank_name,
        routing_number=routing_number,
        account_number=account_number,
    )

    return await supabase_client.insert_row(
        "external_accounts",
        {
            "user_id": current_user.id,
            "bank_name": bank_name,
            "nickname": nickname,
            "account_type": payload.accountType.lower(),
            "masked_account_number": masked,
            "routing_number": routing_number,
            "verification_status": linking_result.verification_status,
            "provider": linking_result.provider,
            "provider_customer_id": linking_result.provider_customer_id,
            "provider_account_id": linking_result.provider_account_id,
            "is_active": True,
        },
    )


async def create_external_link_session_for_user(current_user: SupabaseUser) -> dict[str, str]:
    if settings.EXTERNAL_ACCOUNT_PROVIDER.strip().lower() != "stripe_sandbox":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Stripe sandbox linking is not enabled.",
        )
    customer_id = await create_stripe_customer_for_linking(current_user.email)
    session = await create_financial_connections_session(customer_id=customer_id)
    return {
        "clientSecret": session["clientSecret"],
        "sessionId": session["sessionId"],
        "publishableKey": session["publishableKey"],
    }


def _extract_last4_from_stripe_account(account: dict) -> str:
    direct_last4 = str(account.get("last4") or "").strip()
    if direct_last4.isdigit() and len(direct_last4) == 4:
        return direct_last4
    display_name = str(account.get("display_name") or "")
    digits = "".join(char for char in display_name if char.isdigit())
    if len(digits) >= 4:
        return digits[-4:]
    return "0000"


def _map_stripe_account_type(account: dict) -> str:
    subcategory = str(account.get("subcategory") or "").lower()
    if "sav" in subcategory:
        return "savings"
    return "checking"


async def complete_external_link_for_user(current_user: SupabaseUser, payload: CompleteExternalLinkIn) -> dict:
    if settings.EXTERNAL_ACCOUNT_PROVIDER.strip().lower() != "stripe_sandbox":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Stripe sandbox linking is not enabled.",
        )
    account_id = payload.accountId.strip()
    account = await get_financial_connections_account(account_id)
    institution = account.get("institution") if isinstance(account.get("institution"), dict) else {}
    bank_name = str(institution.get("name") or account.get("institution_name") or "Linked bank").strip()
    if not bank_name:
        bank_name = "Linked bank"
    provider_account_id = str(account.get("id") or "").strip()
    if not provider_account_id:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Stripe account id is missing.")
    account_holder = account.get("account_holder") if isinstance(account.get("account_holder"), dict) else {}
    provider_customer_id = str(account_holder.get("customer") or "").strip() or None
    last4 = _extract_last4_from_stripe_account(account)
    duplicate_rows = await supabase_client.select_rows(
        "external_accounts",
        filters={
            "user_id": f"eq.{current_user.id}",
            "provider": "eq.stripe_sandbox",
            "provider_account_id": f"eq.{provider_account_id}",
            "is_active": "eq.true",
        },
        limit=1,
    )
    if duplicate_rows:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This external account is already linked.",
        )
    return await supabase_client.insert_row(
        "external_accounts",
        {
            "user_id": current_user.id,
            "bank_name": bank_name[:120],
            "nickname": bank_name[:80],
            "account_type": _map_stripe_account_type(account),
            "masked_account_number": f"...{last4}",
            "routing_number": "000000000",
            "verification_status": "verified",
            "provider": "stripe_sandbox",
            "provider_customer_id": provider_customer_id,
            "provider_account_id": provider_account_id,
            "is_active": True,
        },
    )


async def list_external_accounts_for_user(user_id: str) -> list[dict]:
    return await supabase_client.select_rows(
        "external_accounts",
        filters={"user_id": f"eq.{user_id}", "is_active": "eq.true"},
        order="created_at.desc",
    )


async def create_external_transfer_for_user(current_user: SupabaseUser, payload: CreateExternalTransferIn) -> dict:
    from_account = await _get_owned_account(payload.fromAccountId, current_user.id)
    if from_account.get("account_type") != "checking":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="External transfers require a checking account.")
    if from_account.get("status") != "open":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Source account must be open.")

    external_rows = await supabase_client.select_rows(
        "external_accounts",
        filters={"id": f"eq.{payload.externalAccountId}", "user_id": f"eq.{current_user.id}", "is_active": "eq.true"},
        limit=1,
    )
    if not external_rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="External account not found.")
    external_account = external_rows[0]

    amount_cents = amount_to_cents(payload.amount)
    if amount_cents <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Transfer amount must be greater than zero.")
    if payload.scheduleMode == "SCHEDULED":
        cadence, start_date, run_time, end_date, timezone_name = await _validate_schedule_payload(
            current_user=current_user,
            cadence_input=payload.cadence,
            start_date_input=payload.startDate,
            run_time_input=payload.runTime,
            end_date_input=payload.endDate,
            timezone_input=payload.timezone,
        )
        next_run_at = _combine_local_to_utc(
            _parse_iso_date(start_date, field_name="startDate"),
            _parse_local_time(run_time, field_name="runTime"),
            timezone_name,
        )
        plan = await supabase_client.insert_row(
            "external_transfer_plans",
            {
                "user_id": current_user.id,
                "from_account_id": payload.fromAccountId,
                "external_account_id": payload.externalAccountId,
                "amount_cents": amount_cents,
                "memo": payload.memo,
                "cadence": cadence,
                "start_date": start_date,
                "end_date": end_date,
                "run_time": run_time,
                "timezone": timezone_name,
                "next_run_at": next_run_at.isoformat(),
                "status": "scheduled",
            },
        )
        return {"mode": "SCHEDULED", "plan": plan, "external_account": external_account}

    transfer_date = await _validate_immediate_transfer_date(payload.transferDate or date.today().isoformat())
    settle_after = datetime.now(timezone.utc) + timedelta(seconds=EXTERNAL_SETTLEMENT_DELAY_SECONDS)
    result = await supabase_client.rpc(
        "submit_external_outbound_transfer",
        {
            "p_user_id": current_user.id,
            "p_from_account_id": payload.fromAccountId,
            "p_external_account_id": payload.externalAccountId,
            "p_amount_cents": amount_cents,
            "p_transfer_date": transfer_date,
            "p_memo": payload.memo,
            "p_external_transfer_plan_id": None,
            "p_settle_after": settle_after.isoformat(),
        },
    )
    row = result[0] if isinstance(result, list) and result else result or {}
    created_rows = await supabase_client.select_rows(
        "external_transfers",
        filters={"id": f"eq.{row.get('id')}"},
        limit=1,
    )
    return {"mode": "NOW", "transfer": created_rows[0] if created_rows else row, "external_account": external_account}


async def list_external_transfer_plans_for_user(user_id: str) -> list[dict]:
    rows = await supabase_client.select_rows(
        "external_transfer_plans",
        filters={"user_id": f"eq.{user_id}"},
        order="created_at.desc",
    )
    if not rows:
        return []
    external_ids = {row["external_account_id"] for row in rows if row.get("external_account_id")}
    external_accounts = await supabase_client.select_rows(
        "external_accounts",
        filters={"id": f"in.({','.join(external_ids)})"} if external_ids else None,
    ) if external_ids else []
    external_map = {row["id"]: row for row in external_accounts}
    for row in rows:
        ext = external_map.get(row.get("external_account_id"), {})
        row["external_account_label"] = f"{ext.get('bank_name', 'External bank')} {ext.get('masked_account_number', '').strip()}".strip()
    return rows


async def cancel_external_transfer_plan_for_user(user_id: str, plan_id: str) -> dict:
    rows = await supabase_client.update_rows(
        "external_transfer_plans",
        {
            "status": "cancelled",
            "next_run_at": None,
        },
        filters={
            "id": f"eq.{plan_id}",
            "user_id": f"eq.{user_id}",
            "status": "eq.scheduled",
        },
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scheduled external transfer not found.")
    plans = await list_external_transfer_plans_for_user(user_id)
    for plan in plans:
        if plan["id"] == rows[0]["id"]:
            return plan
    return rows[0]


async def update_external_transfer_plan_for_user(user_id: str, plan_id: str, payload: dict) -> dict:
    rows = await supabase_client.select_rows(
        "external_transfer_plans",
        filters={"id": f"eq.{plan_id}", "user_id": f"eq.{user_id}"},
        limit=1,
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scheduled external transfer not found.")
    plan = rows[0]
    if plan.get("status") != "scheduled":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only scheduled transfers can be edited.")

    cadence = _normalize_cadence(payload.get("cadence") or plan.get("cadence"))
    timezone_name = (payload.get("timezone") or plan.get("timezone") or "UTC").strip() or "UTC"
    start_date = _parse_iso_date(payload.get("startDate") or plan.get("start_date"), field_name="startDate")
    run_time = _parse_local_time(payload.get("runTime") or plan.get("run_time"), field_name="runTime")
    end_date_value = payload.get("endDate")
    end_date = _parse_iso_date(end_date_value, field_name="endDate") if end_date_value else (
        _parse_iso_date(plan.get("end_date"), field_name="endDate") if plan.get("end_date") else None
    )
    if end_date and end_date < start_date:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="End date must be on or after start date.")

    next_run_at = _combine_local_to_utc(start_date, run_time, timezone_name)
    min_allowed_utc = datetime.now(timezone.utc) + timedelta(seconds=SCHEDULE_MIN_LEAD_SECONDS)
    if next_run_at <= min_allowed_utc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Scheduled transfers must be at least 1 minute in the future.",
        )

    amount = payload.get("amount")
    amount_cents = amount_to_cents(amount) if amount is not None else int(plan.get("amount_cents", 0))
    if amount_cents <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Transfer amount must be greater than zero.")

    updated_rows = await supabase_client.update_rows(
        "external_transfer_plans",
        {
            "amount_cents": amount_cents,
            "memo": payload.get("memo") if payload.get("memo") is not None else plan.get("memo"),
            "cadence": cadence,
            "start_date": start_date.isoformat(),
            "run_time": run_time.strftime("%H:%M"),
            "end_date": end_date.isoformat() if end_date else None,
            "timezone": timezone_name,
            "next_run_at": next_run_at.isoformat(),
            "last_failure_reason": None,
        },
        filters={"id": f"eq.{plan_id}", "user_id": f"eq.{user_id}", "status": "eq.scheduled"},
    )
    if not updated_rows:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Unable to update scheduled external transfer.")
    plans = await list_external_transfer_plans_for_user(user_id)
    for item in plans:
        if item["id"] == updated_rows[0]["id"]:
            return item
    return updated_rows[0]


async def retry_external_transfer_plan_for_user(user_id: str, plan_id: str) -> dict:
    rows = await supabase_client.select_rows(
        "external_transfer_plans",
        filters={"id": f"eq.{plan_id}", "user_id": f"eq.{user_id}"},
        limit=1,
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scheduled external transfer not found.")
    plan = rows[0]
    if plan.get("status") != "scheduled":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only scheduled transfers can be retried.")

    timezone_name = (plan.get("timezone") or "UTC").strip() or "UTC"
    run_time = _parse_local_time(plan.get("run_time"), field_name="runTime")
    local_today = datetime.now(ZoneInfo(timezone_name)).date()
    cadence = plan["cadence"]
    failure_reason = None

    # Ensure ledger accounts exist for both accounts (safety check)
    await ensure_ledger_accounts_for_transfer(from_account, to_account)

    # Call transactional RPC: all mutations happen atomically in Postgres
    # The RPC uses FOR UPDATE to lock both accounts, validates state, and performs
    # all updates (accounts, transfer, ledger_journals, ledger_postings, transactions, notifications)
    # in one transaction
    try:
        settle_after = datetime.now(timezone.utc) + timedelta(seconds=EXTERNAL_SETTLEMENT_DELAY_SECONDS)
        await supabase_client.rpc(
            "submit_external_outbound_transfer",
            {
                "p_user_id": plan["user_id"],
                "p_from_account_id": plan["from_account_id"],
                "p_external_account_id": plan["external_account_id"],
                "p_amount_cents": plan["amount_cents"],
                "p_transfer_date": local_today.isoformat(),
                "p_memo": plan.get("memo"),
                "p_external_transfer_plan_id": plan["id"],
                "p_settle_after": settle_after.isoformat(),
            },
        )
    except HTTPException as exc:
        failure_reason = str(exc.detail)

    if cadence == "once":
        status_value = "completed" if not failure_reason else "scheduled"
        next_run_at = None if not failure_reason else _combine_local_to_utc(local_today, run_time, timezone_name).isoformat()
    else:
        next_date = _advance_cadence(local_today, cadence) if not failure_reason else local_today
        status_value = "scheduled"
        next_run_at = _combine_local_to_utc(next_date, run_time, timezone_name).isoformat()

    await supabase_client.update_rows(
        "external_transfer_plans",
        {
            "status": status_value,
            "next_run_at": next_run_at,
            "last_run_at": datetime.now(timezone.utc).isoformat(),
            "last_failure_reason": failure_reason,
        },
        filters={"id": f"eq.{plan_id}", "user_id": f"eq.{user_id}"},
    )
    plans = await list_external_transfer_plans_for_user(user_id)
    for item in plans:
        if item["id"] == plan_id:
            return item
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scheduled external transfer not found.")


async def list_external_transfers_for_user(user_id: str) -> list[dict]:
    rows = await supabase_client.select_rows(
        "external_transfers",
        filters={"user_id": f"eq.{user_id}"},
        order="created_at.desc",
    )
    if not rows:
        return []
    external_ids = {row["external_account_id"] for row in rows if row.get("external_account_id")}
    external_accounts = await supabase_client.select_rows(
        "external_accounts",
        filters={"id": f"in.({','.join(external_ids)})"} if external_ids else None,
    ) if external_ids else []
    external_map = {row["id"]: row for row in external_accounts}
    for row in rows:
        ext = external_map.get(row.get("external_account_id"), {})
        row["external_account_label"] = f"{ext.get('bank_name', 'External bank')} {ext.get('masked_account_number', '').strip()}".strip()
    return rows


async def process_due_external_transfers(*, batch_size: int = 50) -> dict[str, int]:
    now_utc = datetime.now(timezone.utc)
    stale_cutoff = now_utc - timedelta(minutes=STALE_PROCESSING_TIMEOUT_MINUTES)

    stale_plan_rows = await supabase_client.select_rows(
        "external_transfer_plans",
        select="id",
        filters={"status": "eq.processing", "updated_at": f"lte.{stale_cutoff.isoformat()}"},
        limit=batch_size,
    )
    reclaimed = 0
    for row in stale_plan_rows:
        reset_rows = await supabase_client.update_rows(
            "external_transfer_plans",
            {"status": "scheduled"},
            filters={"id": f"eq.{row['id']}", "status": "eq.processing"},
        )
        if reset_rows:
            reclaimed += 1

    due_plan_rows = await supabase_client.select_rows(
        "external_transfer_plans",
        filters={"status": "eq.scheduled", "next_run_at": f"lte.{now_utc.isoformat()}"},
        order="next_run_at.asc",
        limit=batch_size,
    )

    scheduled_processed = 0
    scheduled_failed = 0
    settled = 0
    failed = 0
    timezone_cache: dict[str, str] = {}

    for row in due_plan_rows:
        claimed = await supabase_client.update_rows(
            "external_transfer_plans",
            {"status": "processing"},
            filters={"id": f"eq.{row['id']}", "status": "eq.scheduled"},
        )
        if not claimed:
            continue
        plan = claimed[0]
        scheduled_processed += 1
        timezone_name = timezone_cache.get(plan["user_id"])
        if timezone_name is None:
            timezone_name = (plan.get("timezone") or "UTC").strip() or "UTC"
            timezone_cache[plan["user_id"]] = timezone_name
        run_time = _parse_local_time(plan.get("run_time"), field_name="runTime")
        next_run_at = datetime.fromisoformat(plan["next_run_at"].replace("Z", "+00:00"))
        local_run_date = next_run_at.astimezone(ZoneInfo(timezone_name)).date()
        local_today = now_utc.astimezone(ZoneInfo(timezone_name)).date()
        end_date = _parse_iso_date(plan["end_date"], field_name="endDate") if plan.get("end_date") else None
        cadence = plan["cadence"]
        last_failure_reason = None

        try:
            settle_after = now_utc + timedelta(seconds=EXTERNAL_SETTLEMENT_DELAY_SECONDS)
            await supabase_client.rpc(
                "submit_external_outbound_transfer",
                {
                    "p_user_id": plan["user_id"],
                    "p_from_account_id": plan["from_account_id"],
                    "p_external_account_id": plan["external_account_id"],
                    "p_amount_cents": plan["amount_cents"],
                    "p_transfer_date": local_run_date.isoformat(),
                    "p_memo": plan.get("memo"),
                    "p_external_transfer_plan_id": plan["id"],
                    "p_settle_after": settle_after.isoformat(),
                },
            )
        except HTTPException as exc:
            scheduled_failed += 1
            last_failure_reason = str(exc.detail)

        if cadence == "once":
            if last_failure_reason:
                retry_date = local_run_date if local_run_date >= local_today else local_today
                await supabase_client.update_rows(
                    "external_transfer_plans",
                    {
                        "status": "scheduled",
                        "last_run_at": now_utc.isoformat(),
                        "next_run_at": _combine_local_to_utc(retry_date, run_time, timezone_name).isoformat(),
                        "last_failure_reason": last_failure_reason,
                    },
                    filters={"id": f"eq.{plan['id']}"},
                )
                continue
            await supabase_client.update_rows(
                "external_transfer_plans",
                {
                    "status": "completed",
                    "last_run_at": now_utc.isoformat(),
                    "next_run_at": None,
                    "last_failure_reason": None,
                },
                filters={"id": f"eq.{plan['id']}"},
            )
            continue

        if last_failure_reason:
            if local_run_date == local_today:
                retry_date = local_run_date
            elif local_run_date < local_today:
                retry_date = _roll_forward_to_today_or_later(local_run_date, cadence, local_today)
            else:
                retry_date = local_run_date
            await supabase_client.update_rows(
                "external_transfer_plans",
                {
                    "status": "scheduled",
                    "last_run_at": now_utc.isoformat(),
                    "next_run_at": _combine_local_to_utc(retry_date, run_time, timezone_name).isoformat(),
                    "last_failure_reason": last_failure_reason,
                },
                filters={"id": f"eq.{plan['id']}"},
            )
            continue

        success_base_date = local_run_date if local_run_date >= local_today else local_today
        following_date = _advance_cadence(success_base_date, cadence)
        if end_date and following_date > end_date:
            await supabase_client.update_rows(
                "external_transfer_plans",
                {
                    "status": "completed",
                    "last_run_at": now_utc.isoformat(),
                    "next_run_at": None,
                    "last_failure_reason": None,
                },
                filters={"id": f"eq.{plan['id']}"},
            )
            continue

        following_run_at = _combine_local_to_utc(following_date, run_time, timezone_name)
        await supabase_client.update_rows(
            "external_transfer_plans",
            {
                "status": "scheduled",
                "last_run_at": now_utc.isoformat(),
                "next_run_at": following_run_at.isoformat(),
                "last_failure_reason": None,
            },
            filters={"id": f"eq.{plan['id']}"},
        )

    processing_rows = await supabase_client.select_rows(
        "external_transfers",
        filters={"status": "eq.processing", "settle_after": f"lte.{now_utc.isoformat()}"},
        order="settle_after.asc",
        limit=batch_size,
    )

    for row in processing_rows:
        try:
            external_rows = await supabase_client.select_rows(
                "external_accounts",
                filters={"id": f"eq.{row['external_account_id']}"},
                limit=1,
            )
            external_account = external_rows[0] if external_rows else None
            if not external_account or external_account.get("is_active") is not True or external_account.get("verification_status") != "verified":
                await supabase_client.rpc(
                    "fail_external_outbound_transfer",
                    {
                        "p_user_id": row["user_id"],
                        "p_external_transfer_id": row["id"],
                        "p_failure_reason": "External account is no longer available.",
                    },
                )
                failed += 1
                continue

            await supabase_client.rpc(
                "complete_external_outbound_transfer",
                {
                    "p_user_id": row["user_id"],
                    "p_external_transfer_id": row["id"],
                },
            )
            settled += 1
        except HTTPException:
            failed += 1

    return {
        "reclaimed": reclaimed,
        "scheduled_processed": scheduled_processed,
        "scheduled_failed": scheduled_failed,
        "settled": settled,
        "failed": failed,
    }


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
    if from_account_id == to_account_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot transfer to the same account.")

    from_account = await _get_account(from_account_id)
    to_account = await _get_account(to_account_id)

    if enforce_user_ownership and from_account["user_id"] != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to transfer from this account.")

    if from_account["status"] != "open" or to_account["status"] != "open":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Both accounts must be open.")

    if from_account["available_balance_cents"] < amount_cents:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Insufficient balance.")

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
    if isinstance(result, list) and result:
        transfer_id = result[0].get("id")
        if transfer_id:
            await supabase_client.update_rows(
                "transfers",
                {"transfer_plan_id": transfer_plan_id},
                filters={"id": f"eq.{transfer_id}"},
            )
    row = result[0] if isinstance(result, list) and result else result or {}
    return TransferResult(id=row.get("id"), status="COMPLETED", submittedAt=row.get("submitted_at"))


async def process_due_transfer_plans(*, batch_size: int = 50) -> dict[str, int]:
    now_utc = datetime.now(timezone.utc)
    stale_cutoff = now_utc - timedelta(minutes=STALE_PROCESSING_TIMEOUT_MINUTES)

    stale_processing_rows = await supabase_client.select_rows(
        "transfer_plans",
        select="id",
        filters={"status": "eq.processing", "updated_at": f"lte.{stale_cutoff.isoformat()}"},
        limit=batch_size,
    )

    reclaimed = 0
    for stale in stale_processing_rows:
        reset_rows = await supabase_client.update_rows(
            "transfer_plans",
            {"status": "scheduled"},
            filters={"id": f"eq.{stale['id']}", "status": "eq.processing"},
        )
        if reset_rows:
            reclaimed += 1

    due_rows = await supabase_client.select_rows(
        "transfer_plans",
        filters={"status": "eq.scheduled", "next_run_at": f"lte.{now_utc.isoformat()}"},
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
            last_failure_reason = str(exc.detail)
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

    return {"reclaimed": reclaimed, "processed": processed, "succeeded": succeeded, "failed": failed}
