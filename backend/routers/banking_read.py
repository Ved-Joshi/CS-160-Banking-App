from datetime import date, datetime, timezone
import logging
from pathlib import PurePosixPath
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Header, Query, status

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
    CreateExternalAccountIn,
    CreateExternalTransferIn,
    CreateMemberTransferIn,
    CreateScheduledPaymentIn,
    CreateTransferIn,
    CustomerProfile,
    Deposit,
    DepositImage,
    DepositImages,
    DepositUploadUrls,
    ExternalAccount,
    ExternalTransfer,
    ExternalTransferPlan,
    ExternalTransferSubmissionResult,
    MemberTransfer,
    MemberTransferPlan,
    MemberTransferRecipient,
    MemberTransferSubmissionResult,
    NotificationItem,
    Payee,
    ScheduledPayment,
    SignedUploadTarget,
    Transaction,
    TransferResult,
    UpdateCustomerProfileIn,
    UpdateScheduledPaymentIn,
)
from utils.google_maps import SearchCenter, geocode_query, search_chase_atms
from utils.supabase import SupabaseUser, amount_to_cents, cents_to_amount, random_last4, supabase_client
from services.payment_service import (
    attempt_payment_run,
    build_payment_update_payload,
    execute_payment_for_user,
    finalize_idempotency_key,
    get_idempotency_replay,
    get_user_timezone_name,
    local_today_for_timezone,
    next_run_at_for_date,
    parse_deliver_by_with_timezone,
    reserve_idempotency_key,
    validate_payment_amount_or_raise,
)
from services.transfer_service import (
    cancel_external_transfer_plan_for_user,
    cancel_member_transfer_plan_for_user,
    create_external_account_for_user,
    create_external_transfer_for_user,
    create_member_transfer_for_user,
    create_transfer_for_user,
    list_external_accounts_for_user,
    list_external_transfer_plans_for_user,
    list_external_transfers_for_user,
    list_member_transfer_plans_for_user,
    resolve_member_recipient_for_user,
)

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


def map_schedule_mode(value: str | None) -> str:
    return "SCHEDULED" if (value or "").upper() == "SCHEDULED" else "NOW"


def map_transfer_cadence(value: str) -> str:
    return {
        "daily": "Daily",
        "weekly": "Weekly",
        "biweekly": "Biweekly",
        "monthly": "Monthly",
        "once": "Once",
    }.get(value, "Once")


def map_plan_status(value: str) -> str:
    return {
        "processing": "PROCESSING",
        "completed": "COMPLETED",
        "cancelled": "CANCELLED",
    }.get(value, "SCHEDULED")


def map_external_transfer_status(value: str) -> str:
    return {
        "completed": "COMPLETED",
        "failed": "FAILED",
        "cancelled": "CANCELLED",
    }.get(value, "PROCESSING")


def map_external_account_type(value: str) -> str:
    return "Savings" if value == "savings" else "Checking"


def map_external_verification_status(value: str) -> str:
    return {
        "pending": "PENDING",
        "failed": "FAILED",
    }.get(value, "VERIFIED")


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
        isDefaultInternalReceive=bool(row.get("is_default_internal_receive")),
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


def map_member_transfer_recipient(row: dict) -> MemberTransferRecipient:
    return MemberTransferRecipient(
        userId=row["userId"],
        displayName=row["displayName"],
        email=row["email"],
        defaultCheckingAccountMasked=row["defaultCheckingAccountMasked"],
    )


def map_member_transfer(row: dict) -> MemberTransfer:
    return MemberTransfer(
        id=row["id"],
        fromAccountId=row["from_account_id"],
        recipientUserId=row["recipient_user_id"],
        recipientDisplayName=row.get("recipient_display_name") or "Member",
        amount=cents_to_amount(row.get("amount_cents")),
        memo=row.get("memo"),
        transferDate=row.get("transfer_date") or "",
        status=map_transfer_status(row.get("status", "pending")),
        submittedAt=row.get("submitted_at") or row.get("created_at") or "",
        completedAt=row.get("completed_at"),
        failureReason=row.get("failure_reason"),
    )


def map_member_transfer_plan(row: dict) -> MemberTransferPlan:
    return MemberTransferPlan(
        id=row["id"],
        fromAccountId=row["from_account_id"],
        recipientUserId=row["recipient_user_id"],
        recipientEmail=row.get("recipient_handle") or "",
        recipientDisplayName=row.get("recipient_display_name") or "Member",
        amount=cents_to_amount(row.get("amount_cents")),
        memo=row.get("memo"),
        cadence=map_transfer_cadence(row.get("cadence", "once")),
        startDate=row.get("start_date") or "",
        runTime=(row.get("run_time") or "")[:5],
        timezone=row.get("timezone") or "UTC",
        endDate=row.get("end_date"),
        nextRunAt=row.get("next_run_at"),
        lastRunAt=row.get("last_run_at"),
        lastFailureReason=row.get("last_failure_reason"),
        status=map_plan_status(row.get("status", "scheduled")),
        createdAt=row.get("created_at") or "",
        updatedAt=row.get("updated_at") or "",
    )


def map_external_account(row: dict) -> ExternalAccount:
    return ExternalAccount(
        id=row["id"],
        bankName=row.get("bank_name") or "External bank",
        nickname=row.get("nickname") or "External account",
        accountType=map_external_account_type(row.get("account_type", "checking")),
        maskedAccountNumber=row.get("masked_account_number") or "...----",
        routingNumber=row.get("routing_number") or "",
        verificationStatus=map_external_verification_status(row.get("verification_status", "verified")),
        isActive=bool(row.get("is_active", True)),
        createdAt=row.get("created_at") or "",
    )


def map_external_transfer(row: dict) -> ExternalTransfer:
    return ExternalTransfer(
        id=row["id"],
        fromAccountId=row["from_account_id"],
        externalAccountId=row["external_account_id"],
        externalAccountLabel=row.get("external_account_label") or "External bank",
        amount=cents_to_amount(row.get("amount_cents")),
        memo=row.get("memo"),
        transferDate=row.get("transfer_date") or "",
        status=map_external_transfer_status(row.get("status", "processing")),
        submittedAt=row.get("submitted_at") or row.get("created_at") or "",
        processedAt=row.get("processed_at"),
        completedAt=row.get("completed_at"),
        settleAfter=row.get("settle_after"),
        failureReason=row.get("failure_reason"),
    )


def map_external_transfer_plan(row: dict) -> ExternalTransferPlan:
    return ExternalTransferPlan(
        id=row["id"],
        fromAccountId=row["from_account_id"],
        externalAccountId=row["external_account_id"],
        externalAccountLabel=row.get("external_account_label") or "External bank",
        amount=cents_to_amount(row.get("amount_cents")),
        memo=row.get("memo"),
        cadence=map_transfer_cadence(row.get("cadence", "once")),
        startDate=row.get("start_date") or "",
        runTime=(row.get("run_time") or "")[:5],
        timezone=row.get("timezone") or "UTC",
        endDate=row.get("end_date"),
        nextRunAt=row.get("next_run_at"),
        lastRunAt=row.get("last_run_at"),
        lastFailureReason=row.get("last_failure_reason"),
        status=map_plan_status(row.get("status", "scheduled")),
        createdAt=row.get("created_at") or "",
        updatedAt=row.get("updated_at") or "",
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


def normalize_phone_e164(value: str) -> str:
    digits = "".join(char for char in value if char.isdigit())
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) != 10:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Phone number must contain exactly 10 digits.",
        )
    return f"+1{digits}"


def normalize_zip_code(value: str) -> str:
    digits = "".join(char for char in value if char.isdigit())
    if len(digits) == 5:
        return digits
    if len(digits) == 9:
        return f"{digits[:5]}-{digits[5:]}"
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="ZIP code must contain 5 or 9 digits.",
    )


def map_customer_profile(profile: dict, current_user: SupabaseUser) -> CustomerProfile:
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
        streetAddress=profile.get("street_address") or "",
        apartmentUnit=profile.get("apartment_unit") or None,
        city=profile.get("city") or "",
        state=profile.get("state") or "",
        zipCode=profile.get("zip_code") or "",
        memberSince=profile.get("created_at") or current_user.created_at,
        timezone=profile.get("timezone") or "UTC",
    )


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

    return map_customer_profile(rows[0], current_user)

@router.patch("/me/profile", response_model=CustomerProfile)
async def update_profile(
    payload: UpdateCustomerProfileIn,
    current_user: SupabaseUser = Depends(get_current_user),
) -> CustomerProfile:
    updated_rows = await supabase_client.update_rows(
        "profiles",
        {
            "first_name": payload.firstName.strip(),
            "middle_name": payload.middleName.strip() if payload.middleName else None,
            "last_name": payload.lastName.strip(),
            "mobile_phone_e164": normalize_phone_e164(payload.phone),
            "street_address": payload.streetAddress.strip(),
            "apartment_unit": payload.apartmentUnit.strip() if payload.apartmentUnit else None,
            "city": payload.city.strip(),
            "state": payload.state.strip().upper(),
            "zip_code": normalize_zip_code(payload.zipCode),
        },
        filters={"id": f"eq.{current_user.id}"},
    )
    if not updated_rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found.")
    return map_customer_profile(updated_rows[0], current_user)


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
    is_default_internal_receive = False
    if account_type == "checking":
        existing_default = await supabase_client.select_rows(
            "accounts",
            filters={
                "user_id": f"eq.{current_user.id}",
                "account_type": "eq.checking",
                "status": "eq.open",
                "is_default_internal_receive": "eq.true",
            },
            limit=1,
        )
        is_default_internal_receive = len(existing_default) == 0
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
            "is_default_internal_receive": is_default_internal_receive,
        },
    )
    return map_account(created)


@router.post("/accounts/{account_id}/close", status_code=status.HTTP_204_NO_CONTENT)
async def close_account(account_id: str, current_user: SupabaseUser = Depends(get_current_user)) -> None:
    existing_rows = await supabase_client.select_rows(
        "accounts",
        filters={
            "id": f"eq.{account_id}",
            "user_id": f"eq.{current_user.id}",
        },
        limit=1,
    )
    existing_account = existing_rows[0] if existing_rows else None
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
        if existing_account and existing_account.get("is_default_internal_receive"):
            replacement_rows = await supabase_client.select_rows(
                "accounts",
                filters={
                    "user_id": f"eq.{current_user.id}",
                    "account_type": "eq.checking",
                    "status": "eq.open",
                },
                order="opened_at.asc",
                limit=1,
            )
            if replacement_rows:
                await supabase_client.update_rows(
                    "accounts",
                    {"is_default_internal_receive": True},
                    filters={"id": f"eq.{replacement_rows[0]['id']}"},
                )
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


@router.post("/member-transfers/resolve-recipient", response_model=MemberTransferRecipient)
async def resolve_member_recipient(
    payload: dict,
    current_user: SupabaseUser = Depends(get_current_user),
) -> MemberTransferRecipient:
    recipient_email = str(payload.get("recipientEmail") or "").strip()
    recipient = await resolve_member_recipient_for_user(current_user, recipient_email)
    return map_member_transfer_recipient(recipient.model_dump())


@router.post("/member-transfers", response_model=MemberTransferSubmissionResult, status_code=status.HTTP_201_CREATED)
async def create_member_transfer(
    payload: CreateMemberTransferIn,
    current_user: SupabaseUser = Depends(get_current_user),
) -> MemberTransferSubmissionResult:
    result = await create_member_transfer_for_user(current_user, payload)
    transfer = result.get("transfer")
    plan = result.get("plan")
    recipient = result.get("recipient") or {}
    return MemberTransferSubmissionResult(
        mode=map_schedule_mode(result.get("mode")),
        transfer=map_member_transfer({
            **transfer,
            "recipient_display_name": recipient.get("displayName"),
        }) if transfer else None,
        plan=map_member_transfer_plan({
            **plan,
            "recipient_display_name": recipient.get("displayName"),
        }) if plan else None,
    )


@router.get("/member-transfers/plans", response_model=list[MemberTransferPlan])
async def list_member_transfer_plans(
    current_user: SupabaseUser = Depends(get_current_user),
) -> list[MemberTransferPlan]:
    rows = await list_member_transfer_plans_for_user(current_user.id)
    return [map_member_transfer_plan(row) for row in rows if row.get("status") != "completed"]


@router.post("/member-transfers/plans/{plan_id}/cancel", response_model=MemberTransferPlan)
async def cancel_member_transfer_plan(
    plan_id: str,
    current_user: SupabaseUser = Depends(get_current_user),
) -> MemberTransferPlan:
    row = await cancel_member_transfer_plan_for_user(current_user.id, plan_id)
    return map_member_transfer_plan(row)


@router.get("/external-accounts", response_model=list[ExternalAccount])
async def list_external_accounts(
    current_user: SupabaseUser = Depends(get_current_user),
) -> list[ExternalAccount]:
    rows = await list_external_accounts_for_user(current_user.id)
    return [map_external_account(row) for row in rows]


@router.post("/external-accounts", response_model=ExternalAccount, status_code=status.HTTP_201_CREATED)
async def create_external_account(
    payload: CreateExternalAccountIn,
    current_user: SupabaseUser = Depends(get_current_user),
) -> ExternalAccount:
    row = await create_external_account_for_user(current_user, payload)
    return map_external_account(row)


@router.get("/external-transfers", response_model=list[ExternalTransfer])
async def list_external_transfers(
    current_user: SupabaseUser = Depends(get_current_user),
) -> list[ExternalTransfer]:
    rows = await list_external_transfers_for_user(current_user.id)
    return [map_external_transfer(row) for row in rows if row.get("status") in {"processing", "failed"}]


@router.post("/external-transfers", response_model=ExternalTransferSubmissionResult, status_code=status.HTTP_201_CREATED)
async def create_external_transfer(
    payload: CreateExternalTransferIn,
    current_user: SupabaseUser = Depends(get_current_user),
) -> ExternalTransferSubmissionResult:
    result = await create_external_transfer_for_user(current_user, payload)
    transfer = result.get("transfer")
    plan = result.get("plan")
    external_account = result.get("external_account") or {}
    label = f"{external_account.get('bank_name', 'External bank')} {external_account.get('masked_account_number', '')}".strip()
    return ExternalTransferSubmissionResult(
        mode=map_schedule_mode(result.get("mode")),
        transfer=map_external_transfer({
            **transfer,
            "external_account_label": label,
        }) if transfer else None,
        plan=map_external_transfer_plan({
            **plan,
            "external_account_label": label,
        }) if plan else None,
    )


@router.get("/external-transfers/plans", response_model=list[ExternalTransferPlan])
async def list_external_transfer_plans(
    current_user: SupabaseUser = Depends(get_current_user),
) -> list[ExternalTransferPlan]:
    rows = await list_external_transfer_plans_for_user(current_user.id)
    return [map_external_transfer_plan(row) for row in rows if row.get("status") != "completed"]


@router.post("/external-transfers/plans/{plan_id}/cancel", response_model=ExternalTransferPlan)
async def cancel_external_transfer_plan(
    plan_id: str,
    current_user: SupabaseUser = Depends(get_current_user),
) -> ExternalTransferPlan:
    row = await cancel_external_transfer_plan_for_user(current_user.id, plan_id)
    return map_external_transfer_plan(row)


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
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    current_user: SupabaseUser = Depends(get_current_user),
) -> ScheduledPayment:
    if not idempotency_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Idempotency-Key header is required.",
        )

    validate_payment_amount_or_raise(payload.amount)
    idempotency_endpoint = "/api/payments"
    idempotency_payload = {
        "payeeId": payload.payeeId,
        "accountId": payload.accountId,
        "amount": payload.amount,
        "cadence": payload.cadence,
        "deliverBy": payload.deliverBy,
    }
    replay = await get_idempotency_replay(
        user_id=current_user.id,
        endpoint=idempotency_endpoint,
        idempotency_key=idempotency_key,
        request_payload=idempotency_payload,
    )
    if replay is not None:
        return ScheduledPayment.model_validate(replay)
    await reserve_idempotency_key(
        user_id=current_user.id,
        endpoint=idempotency_endpoint,
        idempotency_key=idempotency_key,
        request_payload=idempotency_payload,
    )

    account = await require_owned_account(payload.accountId, current_user.id, require_open=True)
    payee = await require_owned_payee(payload.payeeId, current_user.id)
    timezone_name = await get_user_timezone_name(current_user.id)
    deliver_by = parse_deliver_by_with_timezone(payload.deliverBy, timezone_name)
    normalized_cadence = normalize_payment_cadence(payload.cadence)
    amount_cents = amount_to_cents(payload.amount)

    try:
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
                "next_run_at": next_run_at_for_date(deliver_by, timezone_name),
                "failure_reason": None,
            },
        )

        local_today = local_today_for_timezone(timezone_name)
        should_run_now = normalized_cadence == "once" or date.fromisoformat(deliver_by) == local_today
        if should_run_now:
            now_utc = datetime.now(timezone.utc)
            succeeded_run, failure_reason = await attempt_payment_run(created)
            update_payload = build_payment_update_payload(
                payment=created,
                succeeded_run=succeeded_run,
                failure_reason=failure_reason,
                now_utc=now_utc,
                timezone_name=timezone_name,
            )
            updated_rows = await supabase_client.update_rows(
                "bill_payments",
                update_payload,
                filters={
                    "id": f"eq.{created['id']}",
                    "user_id": f"eq.{current_user.id}",
                },
            )
            created = updated_rows[0] if updated_rows else created

        created["payee"] = {"name": payee.get("name")}
        response = map_payment(created)
        await finalize_idempotency_key(
            user_id=current_user.id,
            endpoint=idempotency_endpoint,
            idempotency_key=idempotency_key,
            response_body=response.model_dump(),
            response_status=status.HTTP_201_CREATED,
        )
        return response
    except HTTPException as exc:
        await finalize_idempotency_key(
            user_id=current_user.id,
            endpoint=idempotency_endpoint,
            idempotency_key=idempotency_key,
            response_body={"detail": exc.detail},
            response_status=exc.status_code,
        )
        raise


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

    timezone_name = await get_user_timezone_name(current_user.id)
    cadence_label = payload.cadence or map_payment_cadence(payment.get("cadence", "once"))
    cadence = normalize_payment_cadence(cadence_label)
    deliver_by = parse_deliver_by_with_timezone(
        payload.deliverBy or payment.get("deliver_by") or local_today_for_timezone(timezone_name).isoformat(),
        timezone_name,
    )
    amount_value = payload.amount if payload.amount is not None else cents_to_amount(payment.get("amount_cents"))
    validate_payment_amount_or_raise(amount_value)
    amount_cents = amount_to_cents(amount_value)

    rows = await supabase_client.update_rows(
        "bill_payments",
        {
            "payee_id": payee["id"],
            "amount_cents": amount_cents,
            "cadence": cadence,
            "deliver_by": deliver_by,
            "status": "scheduled",
            "next_run_at": next_run_at_for_date(deliver_by, timezone_name),
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
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    current_user: SupabaseUser = Depends(get_current_user),
) -> ScheduledPayment:
    if not idempotency_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Idempotency-Key header is required.",
        )

    idempotency_endpoint = f"/api/payments/{payment_id}/retry"
    idempotency_payload = {"paymentId": payment_id}
    replay = await get_idempotency_replay(
        user_id=current_user.id,
        endpoint=idempotency_endpoint,
        idempotency_key=idempotency_key,
        request_payload=idempotency_payload,
    )
    if replay is not None:
        return ScheduledPayment.model_validate(replay)
    await reserve_idempotency_key(
        user_id=current_user.id,
        endpoint=idempotency_endpoint,
        idempotency_key=idempotency_key,
        request_payload=idempotency_payload,
    )

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

    try:
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

        timezone_name = await get_user_timezone_name(current_user.id)
        now_utc = datetime.now(timezone.utc)
        succeeded_run, failure_reason = await attempt_payment_run(payment)
        update_payload = build_payment_update_payload(
            payment=payment,
            succeeded_run=succeeded_run,
            failure_reason=failure_reason,
            now_utc=now_utc,
            timezone_name=timezone_name,
        )
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
        response = map_payment(rows[0])
        await finalize_idempotency_key(
            user_id=current_user.id,
            endpoint=idempotency_endpoint,
            idempotency_key=idempotency_key,
            response_body=response.model_dump(),
            response_status=status.HTTP_200_OK,
        )
        return response
    except HTTPException as exc:
        await finalize_idempotency_key(
            user_id=current_user.id,
            endpoint=idempotency_endpoint,
            idempotency_key=idempotency_key,
            response_body={"detail": exc.detail},
            response_status=exc.status_code,
        )
        raise


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
    if payment.get("status") not in {"scheduled", "failed"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only scheduled or failed payments can be cancelled.",
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
