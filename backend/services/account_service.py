from fastapi import HTTPException, status

from utils.banking_numbers import generate_unique_account_identifiers
from services.ledger_service import ensure_customer_ledger_account
from utils.supabase import SupabaseUser, random_last4, supabase_client


def _is_admin(current_user: SupabaseUser) -> bool:
    roles = current_user.app_metadata.get("roles") or current_user.user_metadata.get("roles") or []
    return isinstance(roles, list) and "admin" in roles


async def create_account_for_user(
    current_user: SupabaseUser,
    account_type: str,
    nickname: str | None = None,
) -> dict:
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
    routing_number, account_number = await generate_unique_account_identifiers()
    payload = {
        "user_id": current_user.id,
        "nickname": nickname,
        "account_type": account_type,
        "account_last4": account_number[-4:],
        "account_number": account_number,
        "routing_number": routing_number,
        "status": "open",
        "available_balance_cents": 0,
        "current_balance_cents": 0,
        "close_eligible": True,
        "is_default_internal_receive": is_default_internal_receive,
    }

    account = await supabase_client.insert_row("accounts", payload)
    
    # Ensure corresponding ledger account is created
    await ensure_customer_ledger_account(account)
    
    return account


async def list_accounts_for_user(current_user: SupabaseUser) -> list[dict]:
    if _is_admin(current_user):
        return await supabase_client.select_rows(
            "accounts",
            order="created_at.desc",
        )

    return await supabase_client.select_rows(
        "accounts",
        filters={"user_id": f"eq.{current_user.id}"},
        order="created_at.desc",
    )


async def get_account_for_user(account_id: str, current_user: SupabaseUser) -> dict:
    rows = await supabase_client.select_rows(
        "accounts",
        filters={"id": f"eq.{account_id}"},
        limit=1,
    )

    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found.")

    account = rows[0]

    if not _is_admin(current_user) and account["user_id"] != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to access this account.",
        )

    return account


async def get_account_balances(account_id: str, current_user: SupabaseUser) -> dict:
    account = await get_account_for_user(account_id, current_user)
    return {
        "account_id": account["id"],
        "available_balance_cents": account["available_balance_cents"],
        "current_balance_cents": account["current_balance_cents"],
    }


async def close_account_for_user(account_id: str, current_user: SupabaseUser) -> dict:
    account = await get_account_for_user(account_id, current_user)

    if account["status"] == "closed":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Account is already closed.",
        )

    if account["current_balance_cents"] != 0 or account["available_balance_cents"] != 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Account balance must be zero to close.",
        )

    if not account["close_eligible"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Account is not eligible to close.",
        )

    updated_rows = await supabase_client.update_rows(
        "accounts",
        {"status": "closed"},
        filters={
            "id": f"eq.{account_id}",
            "user_id": f"eq.{current_user.id}",
        },
    )

    if not updated_rows:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to close account.",
        )

    updated = updated_rows[0]

    return {
        "message": "Account closed successfully",
        "account_id": updated["id"],
        "status": updated["status"],
    }
