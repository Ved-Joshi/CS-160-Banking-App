from datetime import date, datetime, timedelta, timezone
import logging
from calendar import monthrange
from pathlib import PurePosixPath
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status

from dependencies.auth import get_current_user
from schemas.banking import (
    AtmLocation,
    AtmSearchCenter,
    AtmSearchResponse,
    BankAccount,
    CreateBankAccountIn,
    CreateDepositIn,
    CreateDepositUploadUrlsIn,
    CreatePayeeIn,
    CreateScheduledPaymentIn,
    CreateTransferIn,
    CustomerProfile,
    Deposit,
    DepositImage,
    DepositImages,
    DepositUploadUrls,
    NotificationItem,
    Payee,
    ScheduledPayment,
    SignedUploadTarget,
    Transaction,
    TransferResult,
    UpdateScheduledPaymentIn,
)
from utils.google_maps import SearchCenter, geocode_query, search_chase_atms
from utils.supabase import SupabaseUser, amount_to_cents, cents_to_amount, random_last4, supabase_client
from services.payment_service import execute_payment_for_user
from services.transfer_service import create_transfer_for_user

router = APIRouter(prefix="/api", tags=["banking"])
logger = logging.getLogger(__name__)


def map_account_type(value: str) -> str:
    return {
        "checking": "Checking",
        "savings": "Savings",
        "credit": "Credit",
    }.get(value, "Checking")


def map_account_status(value: str) -> str:
    return "Open" if value == "open" else "Restricted"


def normalize_account_type(value: str) -> str:
    return {
        "Checking": "checking",
        "Savings": "savings",
        "Credit": "credit",
    }.get(value, "checking")


def map_transaction_type(value: str) -> str:
    return {
        "deposit": "Deposit",
        "transfer": "Transfer",
        "bill_payment": "Bill Pay",
        "interest": "Interest",
        "fee": "Withdrawal",
        "adjustment": "Withdrawal",
    }.get(value, "Withdrawal")


def map_transaction_status(value: str) -> str:
    return {
        "pending": "PENDING",
        "posted": "COMPLETED",
        "failed": "FAILED",
        "reversed": "FAILED",
    }.get(value, "PENDING")


def normalize_transaction_filter(value: str | None) -> str | None:
    return {
        "Deposit": "eq.deposit",
        "Transfer": "eq.transfer",
        "Bill Pay": "eq.bill_payment",
        "Interest": "eq.interest",
        "Withdrawal": "in.(fee,adjustment)",
        "ATM": "eq.adjustment",
    }.get(value or "")


def normalize_transaction_status_filter(value: str | None) -> str | None:
    return {
        "PENDING": "eq.pending",
        "COMPLETED": "eq.posted",
        "FAILED": "in.(failed,reversed)",
    }.get(value or "")


def map_payment_cadence(value: str) -> str:
    return {
        "once": "Once",
        "daily": "Daily",
        "weekly": "Weekly",
        "biweekly": "Biweekly",
        "monthly": "Monthly",
    }.get(value, "Once")


def map_payment_status(value: str) -> str:
    return {
        "scheduled": "SCHEDULED",
        "processing": "PROCESSING",
        "completed": "COMPLETED",
        "failed": "FAILED",
        "cancelled": "CANCELLED",
    }.get(value, "SCHEDULED")


def normalize_payment_cadence(value: str) -> str:
    return {
        "Once": "once",
        "Daily": "daily",
        "Weekly": "weekly",
        "Biweekly": "biweekly",
        "Monthly": "monthly",
    }.get(value, "once")


def map_deposit_status(value: str) -> str:
    return {
        "submitted": "PENDING_REVIEW",
        "under_review": "PENDING_REVIEW",
        "approved": "APPROVED",
        "rejected": "DECLINED",
    }.get(value, "PENDING_REVIEW")


def map_notification_type(value: str) -> str:
    return {
        "deposit": "deposit",
        "payment": "payment",
        "transfer": "transfer",
        "security": "security",
    }.get(value, "security")


def map_transfer_status(value: str) -> str:
    return {
        "pending": "PENDING",
        "completed": "COMPLETED",
        "failed": "FAILED",
        "cancelled": "FAILED",
    }.get(value, "PENDING")


def build_close_reasons(
    row: dict,
    *,
    pending_transaction_accounts: set[str],
    pending_deposit_accounts: set[str],
    blocked_payment_accounts: set[str],
) -> list[str]:
    reasons: list[str] = []
    status_value = row.get("status", "open")
    if status_value != "open":
        reasons.append("Only open accounts can be closed.")

    available_balance_cents = int(row.get("available_balance_cents") or 0)
    current_balance_cents = int(row.get("current_balance_cents") or 0)
    if available_balance_cents != 0 or current_balance_cents != 0:
        reasons.append("Available and current balances must both be $0.00.")

    account_id = row.get("id")
    if account_id in pending_transaction_accounts:
        reasons.append("Pending transactions must clear before you close this account.")
    if account_id in pending_deposit_accounts:
        reasons.append("Pending deposits must finish review before you close this account.")
    if account_id in blocked_payment_accounts:
        reasons.append("Scheduled or processing bill payments must be resolved before you close this account.")
    return reasons


async def get_close_eligibility_context(user_id: str) -> dict[str, set[str]]:
    pending_transactions = await supabase_client.select_rows(
        "transactions",
        select="account_id",
        filters={
            "user_id": f"eq.{user_id}",
            "status": "eq.pending",
        },
    )
    pending_deposits = await supabase_client.select_rows(
        "deposits",
        select="account_id",
        filters={
            "user_id": f"eq.{user_id}",
            "status": "in.(submitted,under_review)",
        },
    )
    blocked_payments = await supabase_client.select_rows(
        "bill_payments",
        select="account_id",
        filters={
            "user_id": f"eq.{user_id}",
            "status": "in.(scheduled,processing)",
        },
    )
    return {
        "pending_transaction_accounts": {
            row["account_id"] for row in pending_transactions if row.get("account_id")
        },
        "pending_deposit_accounts": {
            row["account_id"] for row in pending_deposits if row.get("account_id")
        },
        "blocked_payment_accounts": {
            row["account_id"] for row in blocked_payments if row.get("account_id")
        },
    }


def map_account(
    row: dict,
    *,
    pending_transaction_accounts: set[str] | None = None,
    pending_deposit_accounts: set[str] | None = None,
    blocked_payment_accounts: set[str] | None = None,
) -> BankAccount:
    nickname = row.get("nickname") or f"{map_account_type(row.get('account_type', 'checking'))} Account"
    last4 = row.get("account_last4") or "----"
    close_reasons = build_close_reasons(
        row,
        pending_transaction_accounts=pending_transaction_accounts or set(),
        pending_deposit_accounts=pending_deposit_accounts or set(),
        blocked_payment_accounts=blocked_payment_accounts or set(),
    )
    can_close = len(close_reasons) == 0
    return BankAccount(
        id=row["id"],
        nickname=nickname,
        type=map_account_type(row.get("account_type", "checking")),
        maskedNumber=f"...{last4}",
        status=map_account_status(row.get("status", "open")),
        routingNumber=row.get("routing_number") or "N/A",
        openedAt=row.get("opened_at") or row.get("created_at") or "",
        closeEligible=can_close,
        canClose=can_close,
        closeReasons=close_reasons,
        balances={
            "availableBalance": cents_to_amount(row.get("available_balance_cents")),
            "currentBalance": cents_to_amount(row.get("current_balance_cents")),
        },
    )


def map_transaction(row: dict) -> Transaction:
    direction = "credit" if row.get("direction") == "in" else "debit"
    description = row.get("description") or map_transaction_type(row.get("type", "adjustment"))
    return Transaction(
        id=row["id"],
        accountId=row["account_id"],
        description=description,
        amount=cents_to_amount(row.get("amount_cents")),
        direction=direction,
        status=map_transaction_status(row.get("status", "pending")),
        type=map_transaction_type(row.get("type", "adjustment")),
        postedAt=row.get("posted_at") or row.get("created_at") or "",
    )


def map_payee(row: dict) -> Payee:
    return Payee(
        id=row["id"],
        name=row.get("name") or "Unnamed payee",
        category=row.get("category") or "Other",
        accountMask=f"...{row.get('account_last4') or '----'}",
    )


def map_payment(row: dict) -> ScheduledPayment:
    payee = row.get("payee") or {}
    return ScheduledPayment(
        id=row["id"],
        payeeId=row["payee_id"],
        payeeName=payee.get("name") or "Manual Payee",
        accountId=row["account_id"],
        amount=cents_to_amount(row.get("amount_cents")),
        cadence=map_payment_cadence(row.get("cadence", "once")),
        deliverBy=row.get("deliver_by") or row.get("created_at") or "",
        status=map_payment_status(row.get("status", "scheduled")),
        failureReason=row.get("failure_reason"),
    )


def map_deposit_image(path: str | None, submitted_at: str) -> DepositImage | None:
    if not path:
        return None
    file_name = PurePosixPath(path).name
    return DepositImage(
        id=path,
        fileName=file_name,
        capturedAt=submitted_at,
    )


def map_deposit(row: dict) -> Deposit:
    submitted_at = row.get("submitted_at") or row.get("created_at") or ""
    return Deposit(
        id=row["id"],
        accountId=row["account_id"],
        amount=cents_to_amount(row.get("amount_cents")),
        submittedAt=submitted_at,
        status=map_deposit_status(row.get("status", "submitted")),
        note=row.get("note"),
        images=DepositImages(
            front=map_deposit_image(row.get("front_image_path"), submitted_at),
            back=map_deposit_image(row.get("back_image_path"), submitted_at),
        ),
    )


def map_notification(row: dict) -> NotificationItem:
    return NotificationItem(
        id=row["id"],
        type=map_notification_type(row.get("type", "security")),
        title=row.get("title") or "Notification",
        body=row.get("body") or "",
        createdAt=row.get("created_at") or "",
        read=bool(row.get("read_at")),
    )


def map_atm(row: dict) -> AtmLocation:
    latitude = float(row.get("latitude") or 0.0)
    longitude = float(row.get("longitude") or 0.0)
    return AtmLocation(
        id=row["id"],
        name=row.get("name") or "ATM",
        address=row.get("address") or "",
        city=row.get("city") or "",
        state=row.get("state") or "",
        zip=row.get("zip_code") or "",
        latitude=latitude,
        longitude=longitude,
        distanceMiles=0.0,
        features=row.get("features") or [],
        hours=row.get("hours_text") or "Hours unavailable",
        openNow=None,
        directionsUrl=f"https://www.google.com/maps/dir/?api=1&destination={latitude},{longitude}",
    )


def format_address(profile: dict) -> str:
    street = ", ".join(part for part in [profile.get("street_address"), profile.get("apartment_unit")] if part)
    locality = ", ".join(part for part in [profile.get("city"), profile.get("state"), profile.get("zip_code")] if part)
    return ", ".join(part for part in [street, locality] if part) or "—"


async def require_owned_account(account_id: str, user_id: str, *, require_open: bool = False) -> dict:
    filters = {
        "id": f"eq.{account_id}",
        "user_id": f"eq.{user_id}",
    }
    if require_open:
        filters["status"] = "eq.open"

    rows = await supabase_client.select_rows("accounts", filters=filters, limit=1)
    if not rows:
        detail = "Open account not found." if require_open else "Account not found."
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)
    return rows[0]


async def require_owned_payee(payee_id: str, user_id: str) -> dict:
    rows = await supabase_client.select_rows(
        "payees",
        filters={
            "id": f"eq.{payee_id}",
            "user_id": f"eq.{user_id}",
            "is_active": "eq.true",
        },
        limit=1,
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payee not found.")
    return rows[0]


def sanitize_file_name(file_name: str) -> str:
    cleaned = "".join(char for char in file_name.strip() if char.isalnum() or char in {".", "-", "_"})
    return cleaned or "image.jpg"


def parse_transfer_date(value: str) -> str:
    try:
        return datetime.strptime(value, "%Y-%m-%d").date().isoformat()
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Transfer date must be in YYYY-MM-DD format.",
        ) from exc


def parse_deliver_by(value: str) -> str:
    try:
        parsed = datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Deliver by date must be in YYYY-MM-DD format.",
        ) from exc

    # Compare against server's local date (not UTC) to match client's date-only input.
    # This prevents rejecting valid same-day dates due to timezone mismatches.
    if parsed < date.today():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Deliver by date cannot be in the past.",
        )

    return parsed.isoformat()


def compute_payment_next_run_at(deliver_by: str) -> str:
    run_date = date.fromisoformat(deliver_by)
    local_tz = datetime.now().astimezone().tzinfo or timezone.utc
    local_midnight = datetime.combine(run_date, datetime.min.time(), tzinfo=local_tz)
    return local_midnight.astimezone(timezone.utc).isoformat()


def advance_payment_deliver_by(deliver_by: str, cadence: str) -> str:
    base_date = date.fromisoformat(deliver_by)
    normalized = cadence.lower()
    if normalized == "daily":
        next_date = base_date + timedelta(days=1)
    elif normalized == "weekly":
        next_date = base_date + timedelta(days=7)
    elif normalized == "biweekly":
        next_date = base_date + timedelta(days=14)
    elif normalized == "monthly":
        year = base_date.year + (1 if base_date.month == 12 else 0)
        month = 1 if base_date.month == 12 else base_date.month + 1
        day = min(base_date.day, monthrange(year, month)[1])
        next_date = date(year, month, day)
    else:
        next_date = base_date
    return next_date.isoformat()


def build_atm_center(
    *,
    lat: float | None,
    lng: float | None,
    query: str | None,
) -> SearchCenter:
    if query:
        return SearchCenter(latitude=0.0, longitude=0.0, label=query)
    if lat is None and lng is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide either lat and lng or a query.",
        )
    if lat is None or lng is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Both lat and lng are required when searching by coordinates.",
        )
    return SearchCenter(latitude=lat, longitude=lng, label="Current location")


@router.get("/me/profile", response_model=CustomerProfile)
async def get_profile(current_user: SupabaseUser = Depends(get_current_user)) -> CustomerProfile:
    rows = await supabase_client.select_rows(
        "profiles",
        filters={"id": f"eq.{current_user.id}"},
        limit=1,
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found.")

    profile = rows[0]
    first_name = profile.get("first_name") or current_user.user_metadata.get("firstName") or ""
    middle_name = profile.get("middle_name") or current_user.user_metadata.get("middleName") or None
    last_name = profile.get("last_name") or current_user.user_metadata.get("lastName") or ""
    full_name = " ".join(
        part for part in [first_name, middle_name, last_name] if part
    ).strip() or current_user.email

    return CustomerProfile(
        id=current_user.id,
        firstName=first_name,
        middleName=middle_name,
        lastName=last_name,
        fullName=full_name,
        email=profile.get("email") or current_user.email,
        phone=profile.get("mobile_phone_e164") or current_user.phone or "—",
        address=format_address(profile),
        memberSince=profile.get("created_at") or current_user.created_at,
    )


@router.get("/accounts", response_model=list[BankAccount])
async def list_accounts(current_user: SupabaseUser = Depends(get_current_user)) -> list[BankAccount]:
    rows = await supabase_client.select_rows(
        "accounts",
        filters={
            "user_id": f"eq.{current_user.id}",
            "status": "eq.open",
        },
        order="opened_at.asc",
    )
    close_context = await get_close_eligibility_context(current_user.id)
    return [
        map_account(
            row,
            pending_transaction_accounts=close_context["pending_transaction_accounts"],
            pending_deposit_accounts=close_context["pending_deposit_accounts"],
            blocked_payment_accounts=close_context["blocked_payment_accounts"],
        )
        for row in rows
    ]


@router.get("/accounts/{account_id}", response_model=BankAccount)
async def get_account(account_id: str, current_user: SupabaseUser = Depends(get_current_user)) -> BankAccount:
    rows = await supabase_client.select_rows(
        "accounts",
        filters={
            "id": f"eq.{account_id}",
            "user_id": f"eq.{current_user.id}",
            "status": "eq.open",
        },
        limit=1,
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found.")
    close_context = await get_close_eligibility_context(current_user.id)
    return map_account(
        rows[0],
        pending_transaction_accounts=close_context["pending_transaction_accounts"],
        pending_deposit_accounts=close_context["pending_deposit_accounts"],
        blocked_payment_accounts=close_context["blocked_payment_accounts"],
    )


@router.post("/accounts", response_model=BankAccount, status_code=status.HTTP_201_CREATED)
async def create_account(
    payload: CreateBankAccountIn,
    current_user: SupabaseUser = Depends(get_current_user),
) -> BankAccount:
    profile_rows = await supabase_client.select_rows(
        "profiles",
        filters={"id": f"eq.{current_user.id}"},
        limit=1,
    )
    if not profile_rows:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Your banking profile is not fully provisioned yet. Complete registration before opening an account.",
        )

    account_type = normalize_account_type(payload.type)
    routing_number = "121000358" if account_type in {"checking", "savings"} else None
    created = await supabase_client.insert_row(
        "accounts",
        {
            "user_id": current_user.id,
            "nickname": payload.nickname.strip(),
            "account_type": account_type,
            "account_last4": random_last4(),
            "routing_number": routing_number,
            "status": "open",
            "available_balance_cents": 0,
            "current_balance_cents": 0,
            "close_eligible": False,
        },
    )
    return map_account(created)


@router.post("/accounts/{account_id}/close", status_code=status.HTTP_204_NO_CONTENT)
async def close_account(account_id: str, current_user: SupabaseUser = Depends(get_current_user)) -> None:
    result = await supabase_client.rpc(
        "close_customer_account",
        {
            "p_user_id": current_user.id,
            "p_account_id": account_id,
        },
    )
    if not isinstance(result, dict):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This account is no longer available to close.",
        )

    if result.get("closed"):
        return

    reasons = [
        reason
        for reason in result.get("reasons", [])
        if isinstance(reason, str) and reason.strip()
    ]
    response_status = int(result.get("status") or status.HTTP_409_CONFLICT)
    if response_status == status.HTTP_404_NOT_FOUND:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=reasons[0] if reasons else "Account not found.",
        )
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "message": "This account can't be closed yet.",
            "reasons": reasons or ["This account is no longer available to close."],
        },
    )


@router.get("/transactions", response_model=list[Transaction])
async def list_transactions(
    account_id: str | None = Query(default=None),
    transaction_type: str | None = Query(default=None, alias="type"),
    status_filter: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=100, ge=1, le=250),
    current_user: SupabaseUser = Depends(get_current_user),
) -> list[Transaction]:
    filters = {"user_id": f"eq.{current_user.id}"}
    if account_id:
        filters["account_id"] = f"eq.{account_id}"
    normalized_type = normalize_transaction_filter(transaction_type)
    if normalized_type:
        filters["type"] = normalized_type
    normalized_status = normalize_transaction_status_filter(status_filter)
    if normalized_status:
        filters["status"] = normalized_status

    rows = await supabase_client.select_rows(
        "transactions",
        filters=filters,
        order="posted_at.desc.nullslast,created_at.desc",
        limit=limit,
    )
    return [map_transaction(row) for row in rows]


@router.post("/transfers", response_model=TransferResult, status_code=status.HTTP_201_CREATED)
async def create_transfer(
    payload: CreateTransferIn,
    current_user: SupabaseUser = Depends(get_current_user),
) -> TransferResult:
    return await create_transfer_for_user(
        current_user=current_user,
        from_account_id=payload.fromAccountId,
        to_account_id=payload.toAccountId,
        amount=payload.amount,
        memo=payload.memo,
        transfer_date=parse_transfer_date(payload.transferDate),
    )


@router.get("/payees", response_model=list[Payee])
async def list_payees(current_user: SupabaseUser = Depends(get_current_user)) -> list[Payee]:
    rows = await supabase_client.select_rows(
        "payees",
        filters={
            "user_id": f"eq.{current_user.id}",
            "is_active": "eq.true",
        },
        order="name.asc",
    )
    return [map_payee(row) for row in rows]


@router.post("/payees", response_model=Payee, status_code=status.HTTP_201_CREATED)
async def create_payee(
    payload: CreatePayeeIn,
    current_user: SupabaseUser = Depends(get_current_user),
) -> Payee:
    created = await supabase_client.insert_row(
        "payees",
        {
            "user_id": current_user.id,
            "name": payload.name.strip(),
            "category": payload.category.strip(),
            "account_last4": payload.accountLast4,
            "is_active": True,
        },
    )
    return map_payee(created)


@router.get("/payments", response_model=list[ScheduledPayment])
async def list_payments(current_user: SupabaseUser = Depends(get_current_user)) -> list[ScheduledPayment]:
    rows = await supabase_client.select_rows(
        "bill_payments",
        select="id,payee_id,account_id,amount_cents,cadence,deliver_by,status,failure_reason,created_at,payee:payee_id(name)",
        filters={"user_id": f"eq.{current_user.id}"},
        order="deliver_by.asc",
    )
    return [map_payment(row) for row in rows]


@router.post("/payments", response_model=ScheduledPayment, status_code=status.HTTP_201_CREATED)
async def create_payment(
    payload: CreateScheduledPaymentIn,
    current_user: SupabaseUser = Depends(get_current_user),
) -> ScheduledPayment:
    account = await require_owned_account(payload.accountId, current_user.id, require_open=True)
    payee = await require_owned_payee(payload.payeeId, current_user.id)
    deliver_by = parse_deliver_by(payload.deliverBy)
    normalized_cadence = normalize_payment_cadence(payload.cadence)
    amount_cents = amount_to_cents(payload.amount)

    created = await supabase_client.insert_row(
        "bill_payments",
        {
            "user_id": current_user.id,
            "payee_id": payee["id"],
            "account_id": account["id"],
            "amount_cents": amount_cents,
            "cadence": normalized_cadence,
            "deliver_by": deliver_by,
            "status": "scheduled",
            "next_run_at": compute_payment_next_run_at(deliver_by),
            "failure_reason": None,
        },
    )

    should_run_now = normalized_cadence == "once" or deliver_by == date.today().isoformat()
    if should_run_now:
        run_failed = False
        failure_reason = "Insufficient balance."
        if int(account.get("available_balance_cents") or 0) >= amount_cents:
            try:
                await supabase_client.rpc(
                    "submit_bill_payment",
                    {
                        "p_user_id": current_user.id,
                        "p_payment_id": created["id"],
                        "p_account_id": account["id"],
                        "p_amount_cents": amount_cents,
                    },
                )
                run_failed = False
            except HTTPException as exc:
                detail = str(exc.detail)
                failure_reason = "Insufficient balance." if "insufficient" in detail.lower() else detail
                run_failed = True
        else:
            run_failed = True

        now_iso = datetime.now(timezone.utc).isoformat()
        if normalized_cadence == "once":
            update_payload = {
                "status": "failed" if run_failed else "completed",
                "next_run_at": None,
                "processed_at": now_iso,
                "failure_reason": failure_reason if run_failed else None,
            }
        else:
            next_deliver_by = advance_payment_deliver_by(deliver_by, normalized_cadence)
            update_payload = {
                "status": "scheduled",
                "deliver_by": next_deliver_by,
                "next_run_at": compute_payment_next_run_at(next_deliver_by),
                "processed_at": now_iso,
                "failure_reason": failure_reason if run_failed else None,
            }

        updated_rows = await supabase_client.update_rows(
            "bill_payments",
            update_payload,
            filters={
                "id": f"eq.{created['id']}",
                "user_id": f"eq.{current_user.id}",
            },
        )
        updated = updated_rows[0] if updated_rows else created
        updated["payee"] = {"name": payee.get("name")}
        return map_payment(updated)

    created["payee"] = {"name": payee.get("name")}
    return map_payment(created)


@router.patch("/payments/{payment_id}", response_model=ScheduledPayment)
async def update_payment(
    payment_id: str,
    payload: UpdateScheduledPaymentIn,
    current_user: SupabaseUser = Depends(get_current_user),
) -> ScheduledPayment:
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
    existing_cadence = map_payment_cadence(payment.get("cadence", "once"))
    existing_status = map_payment_status(payment.get("status", "scheduled"))
    if existing_status == "CANCELLED":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cancelled payments cannot be edited.")
    if existing_cadence == "Once" and existing_status == "COMPLETED":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Completed one-time payments cannot be edited.")

    payee_id = payload.payeeId or payment["payee_id"]
    payee = await require_owned_payee(payee_id, current_user.id)

    cadence_label = payload.cadence or map_payment_cadence(payment.get("cadence", "once"))
    cadence = normalize_payment_cadence(cadence_label)
    deliver_by = parse_deliver_by(payload.deliverBy or payment.get("deliver_by") or date.today().isoformat())
    amount_cents = amount_to_cents(payload.amount if payload.amount is not None else cents_to_amount(payment.get("amount_cents")))

    rows = await supabase_client.update_rows(
        "bill_payments",
        {
            "payee_id": payee["id"],
            "amount_cents": amount_cents,
            "cadence": cadence,
            "deliver_by": deliver_by,
            "status": "scheduled",
            "next_run_at": compute_payment_next_run_at(deliver_by),
            "failure_reason": None,
        },
        filters={
            "id": f"eq.{payment_id}",
            "user_id": f"eq.{current_user.id}",
        },
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payment not found.")
    rows[0]["payee"] = {"name": payee.get("name")}
    return map_payment(rows[0])


@router.post("/payments/{payment_id}/retry", response_model=ScheduledPayment)
async def retry_payment(
    payment_id: str,
    current_user: SupabaseUser = Depends(get_current_user),
) -> ScheduledPayment:
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
    status_label = map_payment_status(payment.get("status", "scheduled"))
    cadence_label = map_payment_cadence(payment.get("cadence", "once"))
    if status_label == "CANCELLED":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cancelled payments cannot be retried.")
    if cadence_label == "Once" and status_label == "COMPLETED":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Completed one-time payments cannot be retried.")

    payee_rows = await supabase_client.select_rows(
        "payees",
        filters={"id": f"eq.{payment['payee_id']}"},
        limit=1,
    )
    payee_name = payee_rows[0]["name"] if payee_rows else "Manual Payee"

    # Mark as processing so submit_bill_payment RPC accepts execution.
    processing_rows = await supabase_client.update_rows(
        "bill_payments",
        {
            "status": "processing",
            "failure_reason": None,
        },
        filters={
            "id": f"eq.{payment_id}",
            "user_id": f"eq.{current_user.id}",
        },
    )
    if processing_rows:
        payment = processing_rows[0]

    amount_cents = int(payment.get("amount_cents") or 0)
    failure_reason = "Insufficient balance."
    run_failed = False
    account_rows = await supabase_client.select_rows(
        "accounts",
        filters={
            "id": f"eq.{payment['account_id']}",
            "user_id": f"eq.{current_user.id}",
            "status": "eq.open",
        },
        limit=1,
    )
    if not account_rows or int(account_rows[0].get("available_balance_cents") or 0) < amount_cents:
        run_failed = True
    else:
        try:
            await supabase_client.rpc(
                "submit_bill_payment",
                {
                    "p_user_id": current_user.id,
                    "p_payment_id": payment["id"],
                    "p_account_id": payment["account_id"],
                    "p_amount_cents": amount_cents,
                },
            )
        except HTTPException as exc:
            detail = str(exc.detail)
            failure_reason = "Insufficient balance." if "insufficient" in detail.lower() else detail
            run_failed = True

    now_iso = datetime.now(timezone.utc).isoformat()
    cadence = normalize_payment_cadence(cadence_label)
    if cadence == "once":
        update_payload = {
            "status": "failed" if run_failed else "completed",
            "next_run_at": None,
            "processed_at": now_iso,
            "failure_reason": failure_reason if run_failed else None,
        }
    else:
        if run_failed:
            update_payload = {
                "status": "failed",
                "processed_at": now_iso,
                "failure_reason": failure_reason,
                "next_run_at": None,
            }
        else:
            base_deliver_by = date.today().isoformat()
            next_deliver_by = advance_payment_deliver_by(base_deliver_by, cadence)
            update_payload = {
                "status": "scheduled",
                "deliver_by": next_deliver_by,
                "next_run_at": compute_payment_next_run_at(next_deliver_by),
                "processed_at": now_iso,
                "failure_reason": None,
            }

    rows = await supabase_client.update_rows(
        "bill_payments",
        update_payload,
        filters={
            "id": f"eq.{payment_id}",
            "user_id": f"eq.{current_user.id}",
        },
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payment not found.")
    rows[0]["payee"] = {"name": payee_name}
    return map_payment(rows[0])


@router.post("/payments/{payment_id}/cancel", response_model=ScheduledPayment)
async def cancel_payment(
    payment_id: str,
    current_user: SupabaseUser = Depends(get_current_user),
) -> ScheduledPayment:
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
    if payment.get("status") not in {"scheduled", "processing", "failed"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only scheduled, processing, or failed payments can be cancelled.",
        )

    rows = await supabase_client.update_rows(
        "bill_payments",
        {
            "status": "cancelled",
            "failure_reason": None,
            "next_run_at": None,
        },
        filters={
            "id": f"eq.{payment_id}",
            "user_id": f"eq.{current_user.id}",
        },
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payment not found.")

    payee_rows = await supabase_client.select_rows(
        "payees",
        filters={"id": f"eq.{payment['payee_id']}"},
        limit=1,
    )
    rows[0]["payee"] = {"name": payee_rows[0]["name"] if payee_rows else "Manual Payee"}
    return map_payment(rows[0])


# DEV-ONLY ENDPOINT: Restricted to admins or DEBUG mode only.
# Authorization is enforced in execute_payment_for_user() - see payment_service.py for details.
@router.post("/dev-payments/{payment_id}/run", response_model=ScheduledPayment)
async def run_payment_now(
    payment_id: str,
    current_user: SupabaseUser = Depends(get_current_user),
) -> ScheduledPayment:
    updated = await execute_payment_for_user(payment_id, current_user)
    payee_rows = await supabase_client.select_rows(
        "payees",
        filters={"id": f"eq.{updated['payee_id']}"},
        limit=1,
    )
    updated["payee"] = {"name": payee_rows[0]["name"] if payee_rows else "Manual Payee"}
    return map_payment(updated)


@router.get("/deposits", response_model=list[Deposit])
async def list_deposits(current_user: SupabaseUser = Depends(get_current_user)) -> list[Deposit]:
    rows = await supabase_client.select_rows(
        "deposits",
        filters={"user_id": f"eq.{current_user.id}"},
        order="submitted_at.desc",
    )
    return [map_deposit(row) for row in rows]


@router.get("/deposits/{deposit_id}", response_model=Deposit)
async def get_deposit(deposit_id: str, current_user: SupabaseUser = Depends(get_current_user)) -> Deposit:
    rows = await supabase_client.select_rows(
        "deposits",
        filters={
            "id": f"eq.{deposit_id}",
            "user_id": f"eq.{current_user.id}",
        },
        limit=1,
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deposit not found.")
    return map_deposit(rows[0])


@router.post("/deposits/upload-urls", response_model=DepositUploadUrls)
async def create_deposit_upload_urls(
    payload: CreateDepositUploadUrlsIn,
    current_user: SupabaseUser = Depends(get_current_user),
) -> DepositUploadUrls:
    deposit_id = str(uuid4())
    front_name = sanitize_file_name(payload.frontFileName)
    back_name = sanitize_file_name(payload.backFileName)
    front_path = f"{current_user.id}/{deposit_id}/front-{front_name}"
    back_path = f"{current_user.id}/{deposit_id}/back-{back_name}"
    front_target = await supabase_client.create_signed_upload_url("deposit-check-images", front_path)
    back_target = await supabase_client.create_signed_upload_url("deposit-check-images", back_path)

    return DepositUploadUrls(
        bucket="deposit-check-images",
        front=SignedUploadTarget(
            path=front_target["path"],
            token=front_target["token"],
            signedUrl=front_target["signedUrl"],
        ),
        back=SignedUploadTarget(
            path=back_target["path"],
            token=back_target["token"],
            signedUrl=back_target["signedUrl"],
        ),
    )


@router.post("/deposits", response_model=Deposit, status_code=status.HTTP_201_CREATED)
async def create_deposit(
    payload: CreateDepositIn,
    current_user: SupabaseUser = Depends(get_current_user),
) -> Deposit:
    account = await require_owned_account(payload.accountId, current_user.id, require_open=True)
    for image_path in [payload.frontImagePath, payload.backImagePath]:
        if not image_path.startswith(f"{current_user.id}/"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Deposit image paths must belong to the authenticated user.",
            )

    created = await supabase_client.insert_row(
        "deposits",
        {
            "user_id": current_user.id,
            "account_id": account["id"],
            "amount_cents": amount_to_cents(payload.amount),
            "status": "under_review",
            "note": "Submitted successfully. Review typically completes in 1 business day.",
            "front_image_path": payload.frontImagePath,
            "back_image_path": payload.backImagePath,
        },
    )
    try:
        await supabase_client.insert_row(
            "notifications",
            {
                "user_id": current_user.id,
                "type": "deposit",
                "title": "Deposit pending review",
                "body": f"Your deposit to {account.get('nickname') or 'your account'} is now under review.",
            },
        )
    except HTTPException as exc:
        logger.warning("Notification insert failed after deposit creation: %s", exc.detail)
    return map_deposit(created)


@router.get("/notifications", response_model=list[NotificationItem])
async def list_notifications(current_user: SupabaseUser = Depends(get_current_user)) -> list[NotificationItem]:
    rows = await supabase_client.select_rows(
        "notifications",
        filters={"user_id": f"eq.{current_user.id}"},
        order="created_at.desc",
    )
    return [map_notification(row) for row in rows]


@router.post("/notifications/{notification_id}/read", response_model=NotificationItem)
async def mark_notification_read(
    notification_id: str,
    current_user: SupabaseUser = Depends(get_current_user),
) -> NotificationItem:
    rows = await supabase_client.update_rows(
        "notifications",
        {"read_at": datetime.now(timezone.utc).isoformat()},
        filters={
            "id": f"eq.{notification_id}",
            "user_id": f"eq.{current_user.id}",
        },
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found.")
    return map_notification(rows[0])


@router.get("/atms/search", response_model=AtmSearchResponse)
async def search_atms(
    lat: float | None = Query(default=None),
    lng: float | None = Query(default=None),
    query: str | None = Query(default=None, min_length=2, max_length=120),
    radius_miles: int = Query(default=10, ge=1, le=25),
    open_now: bool = Query(default=False),
    limit: int = Query(default=20, ge=1, le=50),
) -> AtmSearchResponse:
    query_text = query.strip() if query else None
    if query_text and (lat is not None or lng is not None):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide either coordinates or a search query, not both.",
        )

    center = build_atm_center(lat=lat, lng=lng, query=query_text)
    if query_text:
        center = await geocode_query(query_text)

    atms = await search_chase_atms(
        center=center,
        radius_miles=radius_miles,
        open_now=open_now,
        limit=limit,
    )
    return AtmSearchResponse(
        center=AtmSearchCenter(
            latitude=center.latitude,
            longitude=center.longitude,
            label=center.label,
        ),
        atms=[AtmLocation(**atm) for atm in atms],
    )


@router.get("/atms", response_model=list[AtmLocation])
async def list_atms() -> list[AtmLocation]:
    rows = await supabase_client.select_rows(
        "atm_locations",
        filters={"is_active": "eq.true"},
        order="city.asc,name.asc",
    )
    return [map_atm(row) for row in rows]
