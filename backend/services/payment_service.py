from fastapi import HTTPException, status

from utils.supabase import SupabaseUser, supabase_client


async def execute_payment_for_user(payment_id: str, current_user: SupabaseUser) -> dict:
    """
    Execute a scheduled bill payment for a user using a transactional RPC.
    
    This ensures atomicity: if the payment cannot be completed due to insufficient
    balance, no state is mutated (the payment remains scheduled for retry).
    
    Args:
        payment_id: The bill payment UUID
        current_user: The authenticated user
        
    Returns:
        The updated bill_payments row
        
    Raises:
        HTTPException: If payment not found, validation fails, or insufficient balance
    """
    # Fetch payment and account info for validation (non-mutating reads)
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
    if payment.get("status") not in {"scheduled", "processing"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only scheduled or processing payments can be executed.",
        )

    account_rows = await supabase_client.select_rows(
        "accounts",
        filters={
            "id": f"eq.{payment['account_id']}",
            "user_id": f"eq.{current_user.id}",
            "status": "eq.open",
        },
        limit=1,
    )
    if not account_rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Funding account not found.")

    account = account_rows[0]
    amount_cents = int(payment.get("amount_cents") or 0)
    available_balance_cents = int(account.get("available_balance_cents") or 0)

    # Check balance BEFORE calling RPC - return error without mutation
    if available_balance_cents < amount_cents:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Insufficient balance.")

    # Call transactional RPC: all mutations happen atomically in Postgres
    # The RPC uses FOR UPDATE to lock the account, validates state, and performs
    # all updates (account, bill_payment, ledger_journals, transactions) in one transaction
    try:
        result = await supabase_client.rpc(
            "submit_bill_payment",
            {
                "p_user_id": current_user.id,
                "p_payment_id": payment_id,
                "p_account_id": payment["account_id"],
                "p_amount_cents": amount_cents,
            },
        )
    except HTTPException as exc:
        # RPC errors (e.g., insufficient balance, account not found) should propagate
        # with appropriate HTTP status codes
        if "Insufficient available balance" in str(exc.detail):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Insufficient balance.",
            ) from exc
        raise

    # Return the updated payment (fetch fresh from DB to ensure consistency)
    updated_rows = await supabase_client.select_rows(
        "bill_payments",
        filters={
            "id": f"eq.{payment_id}",
            "user_id": f"eq.{current_user.id}",
        },
        limit=1,
    )
    if not updated_rows:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch updated payment.",
        )

    return updated_rows[0]
