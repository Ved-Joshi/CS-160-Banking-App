from fastapi import APIRouter, Depends, HTTPException, Query, status

from dependencies.auth import require_admin
from schemas.banking import (
    AdminAccountReportResponse,
    AdminAccountReportRow,
    AdminAccountReportSummary,
    BankAccount,
)
from utils.supabase import supabase_client

router = APIRouter(prefix="/api/admin", tags=["admin"])


def map_account(row: dict) -> BankAccount:
    nickname = row.get("nickname") or "Account"
    account_number = row.get("account_number")
    last4 = row.get("account_last4") or (account_number[-4:] if isinstance(account_number, str) and len(account_number) >= 4 else "----")
    return BankAccount(
        id=row["id"],
        nickname=nickname,
        type={
            "checking": "Checking",
            "savings": "Savings",
            "credit": "Credit",
        }.get(row.get("account_type", "checking"), "Checking"),
        maskedNumber=f"...{last4}",
        status="Open" if row.get("status", "open") == "open" else "Restricted",
        routingNumber=row.get("routing_number") or "N/A",
        openedAt=row.get("opened_at") or row.get("created_at") or "",
        closeEligible=bool(row.get("close_eligible")),
        canClose=False,
        closeReasons=[],
        balances={
            "availableBalance": (row.get("available_balance_cents") or 0) / 100,
            "currentBalance": (row.get("current_balance_cents") or 0) / 100,
        },
    )


def map_profile_name(profile: dict) -> str:
    first_name = str(profile.get("first_name") or "").strip()
    middle_name = str(profile.get("middle_name") or "").strip()
    last_name = str(profile.get("last_name") or "").strip()
    full_name = " ".join(part for part in [first_name, middle_name, last_name] if part).strip()
    if full_name:
        return full_name
    email = str(profile.get("email") or "").strip()
    return email or "Unknown customer"


def map_account_type(value: str) -> str:
    return {
        "checking": "Checking",
        "savings": "Savings",
        "credit": "Credit",
    }.get(value, "Checking")


def map_account_status(value: str) -> str:
    return "Open" if value == "open" else "Restricted"


def normalize_account_type_filter(value: str | None) -> str | None:
    if not value:
        return None
    lowered = value.strip().lower()
    if lowered in {"checking", "savings", "credit"}:
        return lowered
    return None


def normalize_status_filter(value: str | None) -> str | None:
    if not value:
        return None
    lowered = value.strip().lower()
    if lowered in {"open", "restricted"}:
        return lowered
    return None


@router.get("/accounts", response_model=list[BankAccount])
async def list_accounts(admin=Depends(require_admin)) -> list[BankAccount]:
    rows = await supabase_client.select_rows(
        "accounts",
        filters={"status": "neq.closed"},
        order="created_at.asc",
    )
    return [map_account(row) for row in rows]


@router.get("/reports/accounts", response_model=AdminAccountReportResponse)
async def account_report(
    search: str | None = Query(default=None, description="Free text search against account/customer fields."),
    min_balance: float | None = Query(default=None, ge=0),
    max_balance: float | None = Query(default=None, ge=0),
    zip_code: str | None = Query(default=None),
    city: str | None = Query(default=None),
    state: str | None = Query(default=None),
    account_type: str | None = Query(default=None, description="checking, savings, or credit"),
    status_filter: str | None = Query(default=None, alias="status", description="open or restricted"),
    limit: int = Query(default=1000, ge=1, le=5000),
    admin=Depends(require_admin),
) -> AdminAccountReportResponse:
    account_rows = await supabase_client.select_rows(
        "accounts",
        filters={"status": "neq.closed"},
        order="created_at.desc",
    )
    user_ids = sorted({str(row.get("user_id") or "").strip() for row in account_rows if row.get("user_id")})

    profile_rows: list[dict] = []
    if user_ids:
        profile_rows = await supabase_client.select_rows(
            "profiles",
            select="id,first_name,middle_name,last_name,email,city,state,zip_code",
            filters={"id": f"in.({','.join(user_ids)})"},
        )
    profiles_by_id = {str(row.get("id")): row for row in profile_rows if row.get("id")}

    normalized_search = (search or "").strip().lower()
    normalized_zip = (zip_code or "").strip().lower()
    normalized_city = (city or "").strip().lower()
    normalized_state = (state or "").strip().lower()
    normalized_type = normalize_account_type_filter(account_type)
    normalized_status = normalize_status_filter(status_filter)

    report_rows: list[AdminAccountReportRow] = []
    for row in account_rows:
        user_id = str(row.get("user_id") or "").strip()
        profile = profiles_by_id.get(user_id, {})
        customer_name = map_profile_name(profile)
        customer_email = str(profile.get("email") or "").strip()
        account_type_value = map_account_type(str(row.get("account_type") or "checking"))
        account_status_value = map_account_status(str(row.get("status") or "open"))
        account_last4 = str(row.get("account_last4") or "----")
        current_balance = (row.get("current_balance_cents") or 0) / 100
        available_balance = (row.get("available_balance_cents") or 0) / 100
        profile_zip = str(profile.get("zip_code") or "").strip()
        profile_city = str(profile.get("city") or "").strip()
        profile_state = str(profile.get("state") or "").strip()

        if normalized_type and account_type_value.lower() != normalized_type:
            continue
        if normalized_status and account_status_value.lower() != normalized_status:
            continue
        if min_balance is not None and current_balance < min_balance:
            continue
        if max_balance is not None and current_balance > max_balance:
            continue
        if normalized_zip and not profile_zip.lower().startswith(normalized_zip):
            continue
        if normalized_city and normalized_city not in profile_city.lower():
            continue
        if normalized_state and normalized_state != profile_state.lower():
            continue

        searchable_fields = [
            str(row.get("id") or ""),
            str(row.get("nickname") or ""),
            f"...{account_last4}",
            account_type_value,
            account_status_value,
            customer_name,
            customer_email,
            profile_zip,
            profile_city,
            profile_state,
        ]
        if normalized_search and not any(normalized_search in field.lower() for field in searchable_fields):
            continue

        report_rows.append(
            AdminAccountReportRow(
                accountId=str(row.get("id") or ""),
                customerId=user_id,
                customerName=customer_name,
                customerEmail=customer_email,
                zipCode=profile_zip,
                city=profile_city,
                state=profile_state,
                accountNickname=str(row.get("nickname") or "Account"),
                accountType=account_type_value,
                accountStatus=account_status_value,
                openedAt=str(row.get("opened_at") or row.get("created_at") or ""),
                currentBalance=current_balance,
                availableBalance=available_balance,
                maskedNumber=f"...{account_last4}",
            ),
        )

    limited_rows = report_rows[:limit]
    summary = AdminAccountReportSummary(
        totalAccounts=len(limited_rows),
        distinctCustomers=len({item.customerId for item in limited_rows if item.customerId}),
        openAccounts=sum(1 for item in limited_rows if item.accountStatus == "Open"),
        restrictedAccounts=sum(1 for item in limited_rows if item.accountStatus == "Restricted"),
        totalCurrentBalance=sum(item.currentBalance for item in limited_rows),
        averageCurrentBalance=(
            sum(item.currentBalance for item in limited_rows) / len(limited_rows)
            if limited_rows
            else 0
        ),
    )

    return AdminAccountReportResponse(rows=limited_rows, summary=summary)


@router.delete("/accounts/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(account_id: str, admin=Depends(require_admin)) -> None:
    rows = await supabase_client.select_rows(
        "accounts",
        select="id,user_id,status",
        filters={"id": f"eq.{account_id}"},
        limit=1,
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found.")
    account = rows[0]
    if account.get("status") == "closed":
        return

    result = await supabase_client.rpc(
        "close_customer_account",
        {
            "p_user_id": account["user_id"],
            "p_account_id": account_id,
        },
    )
    if not isinstance(result, dict):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This account can't be deleted right now.",
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
            "message": "This account can't be deleted yet.",
            "reasons": reasons or ["This account is no longer available to close."],
        },
    )
