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
    """
    Create and execute an internal transfer between accounts using a transactional RPC.
    
    This uses the submit_internal_transfer RPC to ensure all mutations happen atomically:
    - Account balance updates, transfer creation, journal entries, ledger postings, and
      transaction records are all applied in a single Postgres transaction with FOR UPDATE locks.
    
    If the transfer cannot be completed due to insufficient balance, no state is mutated
    and the request fails with 400 Bad Request.
    
    Args:
        current_user: The authenticated user
        from_account_id: Source account UUID
        to_account_id: Destination account UUID  
        amount: Transfer amount in dollars
        memo: Optional transfer memo
        transfer_date: Transfer date (must be current date)
        
    Returns:
        TransferResult with transfer ID, status, and submitted timestamp
        
    Raises:
        HTTPException: If validation fails or insufficient balance
    """
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

    # Fetch accounts for validation (non-mutating reads)
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
        # RPC errors should propagate with appropriate HTTP status codes
        if "Insufficient available funds" in str(exc.detail):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Insufficient balance.",
            ) from exc
        elif any(msg in str(exc.detail) for msg in ["not found", "open", "different accounts"]):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(exc.detail),
            ) from exc
        raise

    # Result contains: id, status, submitted_at from the RPC
    # Note: result may be a list with one row (Supabase RPC returns rows)
    if isinstance(result, list):
        result = result[0] if result else {}
    
    return TransferResult(
        id=result.get("id"),
        status="COMPLETED",
        submittedAt=result.get("submitted_at"),
    )