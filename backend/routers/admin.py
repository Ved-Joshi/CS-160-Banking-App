from fastapi import APIRouter, Depends, HTTPException, status

from dependencies.auth import require_admin
from schemas.banking import BankAccount
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


@router.get("/accounts", response_model=list[BankAccount])
async def list_accounts(admin=Depends(require_admin)) -> list[BankAccount]:
    rows = await supabase_client.select_rows("accounts", order="created_at.asc")
    return [map_account(row) for row in rows]


@router.delete("/accounts/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(account_id: str, admin=Depends(require_admin)) -> None:
    rows = await supabase_client.select_rows("accounts", filters={"id": f"eq.{account_id}"}, limit=1)
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found.")
    await supabase_client.delete_rows("accounts", filters={"id": f"eq.{account_id}"})
