from datetime import date, datetime, timezone

from fastapi import HTTPException, status

from schemas.banking import TransferResult
from utils.supabase import SupabaseUser, amount_to_cents, supabase_client


def _is_admin(current_user: SupabaseUser) -> bool:
    roles = current_user.app_metadata.get("roles") or current_user.user_metadata.get("roles") or []
    return isinstance(roles, list) and "admin" in roles


def _normalize_account_type_label(value: str) -> str:
    return value.capitalize()


async def _get_account(account_id: str) -> dict:
    rows = await supabase_client.select_rows(
        "accounts",
        filters={"id": f"eq.{account_id}"},
        limit=1,
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found.")
    return rows[0]


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

    transfer = await supabase_client.insert_row(
        "transfers",
        {
            "user_id": current_user.id,
            "from_account_id": from_account_id,
            "to_account_id": to_account_id,
            "amount_cents": amount_cents,
            "memo": memo,
            "transfer_date": transfer_date,
            "status": "completed",
            "completed_at": datetime.now(timezone.utc).isoformat(),
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
            "created_by": current_user.id,
        },
    )

    await supabase_client.insert_row(
        "transactions",
        {
            "user_id": current_user.id,
            "account_id": from_account_id,
            "journal_id": journal["id"],
            "type": "transfer",
            "direction": "out",
            "amount_cents": amount_cents,
            "description": memo or "Transfer out",
            "status": "posted",
            "posted_at": datetime.now(timezone.utc).isoformat(),
            "transfer_id": transfer["id"],
        },
    )

    await supabase_client.insert_row(
        "transactions",
        {
            "user_id": to_account["user_id"],
            "account_id": to_account_id,
            "journal_id": journal["id"],
            "type": "transfer",
            "direction": "in",
            "amount_cents": amount_cents,
            "description": memo or "Transfer in",
            "status": "posted",
            "posted_at": datetime.now(timezone.utc).isoformat(),
            "transfer_id": transfer["id"],
        },
    )
    

    return TransferResult(
        id=transfer["id"],
        status="COMPLETED",
        submittedAt=transfer["submitted_at"],
    )