from pathlib import PurePosixPath

from fastapi import APIRouter, Depends, HTTPException, Query, status

from dependencies.auth import get_current_user
from schemas.banking import AtmLocation, BankAccount, CustomerProfile, Deposit, DepositImage, DepositImages, NotificationItem, Payee, ScheduledPayment, Transaction
from utils.supabase import SupabaseUser, cents_to_amount, supabase_client

router = APIRouter(prefix="/api", tags=["banking"])


def map_account_type(value: str) -> str:
    return {
        "checking": "Checking",
        "savings": "Savings",
        "credit": "Credit",
    }.get(value, "Checking")


def map_account_status(value: str) -> str:
    return "Open" if value == "open" else "Restricted"


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


def map_payment_cadence(value: str) -> str:
    return {
        "once": "Once",
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


def map_account(row: dict) -> BankAccount:
    nickname = row.get("nickname") or f"{map_account_type(row.get('account_type', 'checking'))} Account"
    last4 = row.get("account_last4") or "----"
    return BankAccount(
        id=row["id"],
        nickname=nickname,
        type=map_account_type(row.get("account_type", "checking")),
        maskedNumber=f"...{last4}",
        status=map_account_status(row.get("status", "open")),
        routingNumber=row.get("routing_number") or "N/A",
        openedAt=row.get("opened_at") or row.get("created_at") or "",
        closeEligible=bool(row.get("close_eligible")),
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
    return AtmLocation(
        id=row["id"],
        name=row.get("name") or "ATM",
        address=row.get("address") or "",
        city=row.get("city") or "",
        state=row.get("state") or "",
        zip=row.get("zip_code") or "",
        distanceMiles=0.0,
        features=row.get("features") or [],
        hours=row.get("hours_text") or "Hours unavailable",
    )


def format_address(profile: dict) -> str:
    street = ", ".join(part for part in [profile.get("street_address"), profile.get("apartment_unit")] if part)
    locality = ", ".join(part for part in [profile.get("city"), profile.get("state"), profile.get("zip_code")] if part)
    return ", ".join(part for part in [street, locality] if part) or "—"


@router.get("/me/profile", response_model=CustomerProfile)
async def get_profile(current_user: SupabaseUser = Depends(get_current_user)) -> CustomerProfile:
    rows = supabase_client.select_rows(
        "profiles",
        filters={"id": f"eq.{current_user.id}"},
        limit=1,
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found.")

    profile = rows[0]
    first_name = profile.get("first_name") or current_user.user_metadata.get("firstName") or ""
    last_name = profile.get("last_name") or current_user.user_metadata.get("lastName") or ""
    full_name = " ".join(part for part in [first_name, last_name] if part).strip() or profile.get("username") or current_user.email

    return CustomerProfile(
        id=current_user.id,
        fullName=full_name,
        username=profile.get("username"),
        email=profile.get("email") or current_user.email,
        phone=profile.get("mobile_phone_e164") or current_user.phone or "—",
        address=format_address(profile),
        memberSince=profile.get("created_at") or current_user.created_at,
        mfaEnabled=bool(profile.get("mfa_enrolled_at") or profile.get("phone_verified_at")),
    )


@router.get("/accounts", response_model=list[BankAccount])
async def list_accounts(current_user: SupabaseUser = Depends(get_current_user)) -> list[BankAccount]:
    rows = supabase_client.select_rows(
        "accounts",
        filters={"user_id": f"eq.{current_user.id}"},
        order="opened_at.asc",
    )
    return [map_account(row) for row in rows]


@router.get("/accounts/{account_id}", response_model=BankAccount)
async def get_account(account_id: str, current_user: SupabaseUser = Depends(get_current_user)) -> BankAccount:
    rows = supabase_client.select_rows(
        "accounts",
        filters={
            "id": f"eq.{account_id}",
            "user_id": f"eq.{current_user.id}",
        },
        limit=1,
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found.")
    return map_account(rows[0])


@router.get("/transactions", response_model=list[Transaction])
async def list_transactions(
    account_id: str | None = Query(default=None),
    type: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=100, ge=1, le=250),
    current_user: SupabaseUser = Depends(get_current_user),
) -> list[Transaction]:
    filters = {"user_id": f"eq.{current_user.id}"}
    if account_id:
        filters["account_id"] = f"eq.{account_id}"

    rows = supabase_client.select_rows(
        "transactions",
        filters=filters,
        order="posted_at.desc.nullslast,created_at.desc",
        limit=limit,
    )
    mapped = [map_transaction(row) for row in rows]

    if type:
        mapped = [row for row in mapped if row.type == type]
    if status_filter:
        mapped = [row for row in mapped if row.status == status_filter]

    return mapped


@router.get("/payees", response_model=list[Payee])
async def list_payees(current_user: SupabaseUser = Depends(get_current_user)) -> list[Payee]:
    rows = supabase_client.select_rows(
        "payees",
        filters={
            "user_id": f"eq.{current_user.id}",
            "is_active": "eq.true",
        },
        order="name.asc",
    )
    return [map_payee(row) for row in rows]


@router.get("/payments", response_model=list[ScheduledPayment])
async def list_payments(current_user: SupabaseUser = Depends(get_current_user)) -> list[ScheduledPayment]:
    rows = supabase_client.select_rows(
        "bill_payments",
        select="id,payee_id,account_id,amount_cents,cadence,deliver_by,status,created_at,payee:payee_id(name)",
        filters={"user_id": f"eq.{current_user.id}"},
        order="deliver_by.asc",
    )
    return [map_payment(row) for row in rows]


@router.get("/deposits", response_model=list[Deposit])
async def list_deposits(current_user: SupabaseUser = Depends(get_current_user)) -> list[Deposit]:
    rows = supabase_client.select_rows(
        "deposits",
        filters={"user_id": f"eq.{current_user.id}"},
        order="submitted_at.desc",
    )
    return [map_deposit(row) for row in rows]


@router.get("/deposits/{deposit_id}", response_model=Deposit)
async def get_deposit(deposit_id: str, current_user: SupabaseUser = Depends(get_current_user)) -> Deposit:
    rows = supabase_client.select_rows(
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


@router.get("/notifications", response_model=list[NotificationItem])
async def list_notifications(current_user: SupabaseUser = Depends(get_current_user)) -> list[NotificationItem]:
    rows = supabase_client.select_rows(
        "notifications",
        filters={"user_id": f"eq.{current_user.id}"},
        order="created_at.desc",
    )
    return [map_notification(row) for row in rows]


@router.get("/atms", response_model=list[AtmLocation])
async def list_atms() -> list[AtmLocation]:
    rows = supabase_client.select_rows(
        "atm_locations",
        filters={"is_active": "eq.true"},
        order="city.asc,name.asc",
    )
    return [map_atm(row) for row in rows]
