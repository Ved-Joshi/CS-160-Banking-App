from fastapi import APIRouter, Depends, HTTPException, Query, status

from dependencies.auth import get_current_user
from schemas.banking import BankAccount, CustomerProfile, Transaction
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
