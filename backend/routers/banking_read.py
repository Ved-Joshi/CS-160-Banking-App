from pathlib import PurePosixPath
from datetime import datetime, timezone
import logging
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status

from dependencies.auth import get_current_user
from schemas.banking import (
    AtmLocation,
    BankAccount,
    CreateBankAccountIn,
    CreateDepositIn,
    CreateDepositUploadUrlsIn,
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
)
from utils.supabase import SupabaseUser, amount_to_cents, cents_to_amount, random_last4, supabase_client

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


async def require_owned_account(account_id: str, user_id: str) -> dict:
    rows = await supabase_client.select_rows(
        "accounts",
        filters={
            "id": f"eq.{account_id}",
            "user_id": f"eq.{user_id}",
        },
        limit=1,
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found.")
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
        mfaEnabled=bool(profile.get("mfa_enrolled_at") or profile.get("phone_verified_at")),
    )


@router.get("/accounts", response_model=list[BankAccount])
async def list_accounts(current_user: SupabaseUser = Depends(get_current_user)) -> list[BankAccount]:
    rows = await supabase_client.select_rows(
        "accounts",
        filters={"user_id": f"eq.{current_user.id}"},
        order="opened_at.asc",
    )
    return [map_account(row) for row in rows]


@router.get("/accounts/{account_id}", response_model=BankAccount)
async def get_account(account_id: str, current_user: SupabaseUser = Depends(get_current_user)) -> BankAccount:
    rows = await supabase_client.select_rows(
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
    try:
        result = await supabase_client.rpc(
            "submit_internal_transfer",
            {
                "p_user_id": current_user.id,
                "p_from_account_id": payload.fromAccountId,
                "p_to_account_id": payload.toAccountId,
                "p_amount_cents": amount_to_cents(payload.amount),
                "p_transfer_date": parse_transfer_date(payload.transferDate),
                "p_memo": payload.memo,
            },
        )
    except HTTPException as exc:
        detail = exc.detail
        if isinstance(detail, dict):
            detail = detail.get("message") or detail.get("details") or detail
        if isinstance(detail, list) and detail:
            detail = detail[0]
        raise HTTPException(status_code=exc.status_code, detail=detail) from exc

    row = result[0] if isinstance(result, list) else result
    return TransferResult(
        id=row["id"],
        status=map_transfer_status(row.get("status", "pending")),
        submittedAt=row.get("submitted_at") or datetime.now(timezone.utc).isoformat(),
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


@router.get("/payments", response_model=list[ScheduledPayment])
async def list_payments(current_user: SupabaseUser = Depends(get_current_user)) -> list[ScheduledPayment]:
    rows = await supabase_client.select_rows(
        "bill_payments",
        select="id,payee_id,account_id,amount_cents,cadence,deliver_by,status,created_at,payee:payee_id(name)",
        filters={"user_id": f"eq.{current_user.id}"},
        order="deliver_by.asc",
    )
    return [map_payment(row) for row in rows]


@router.post("/payments", response_model=ScheduledPayment, status_code=status.HTTP_201_CREATED)
async def create_payment(
    payload: CreateScheduledPaymentIn,
    current_user: SupabaseUser = Depends(get_current_user),
) -> ScheduledPayment:
    account = await require_owned_account(payload.accountId, current_user.id)
    payee = await require_owned_payee(payload.payeeId, current_user.id)

    created = await supabase_client.insert_row(
        "bill_payments",
        {
            "user_id": current_user.id,
            "payee_id": payee["id"],
            "account_id": account["id"],
            "amount_cents": amount_to_cents(payload.amount),
            "cadence": normalize_payment_cadence(payload.cadence),
            "deliver_by": payload.deliverBy,
            "status": "scheduled",
            "next_run_at": f"{payload.deliverBy}T00:00:00+00:00",
        },
    )
    created["payee"] = {"name": payee.get("name")}
    return map_payment(created)


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
    account = await require_owned_account(payload.accountId, current_user.id)
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


@router.get("/atms", response_model=list[AtmLocation])
async def list_atms() -> list[AtmLocation]:
    rows = await supabase_client.select_rows(
        "atm_locations",
        filters={"is_active": "eq.true"},
        order="city.asc,name.asc",
    )
    return [map_atm(row) for row in rows]
