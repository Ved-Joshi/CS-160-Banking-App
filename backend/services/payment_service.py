from datetime import datetime, timezone

from fastapi import HTTPException, status

from utils.supabase import SupabaseUser, supabase_client


async def execute_payment_for_user(payment_id: str, current_user: SupabaseUser) -> dict:
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
    current_balance_cents = int(account.get("current_balance_cents") or 0)

    if available_balance_cents < amount_cents:
        await supabase_client.update_rows(
            "bill_payments",
            {
                "status": "failed",
                "failure_reason": "Insufficient balance",
            },
            filters={
                "id": f"eq.{payment_id}",
                "user_id": f"eq.{current_user.id}",
            },
        )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Insufficient balance.")

    posted_at = datetime.now(timezone.utc).isoformat()

    await supabase_client.update_rows(
        "accounts",
        {
            "available_balance_cents": available_balance_cents - amount_cents,
            "current_balance_cents": current_balance_cents - amount_cents,
        },
        filters={"id": f"eq.{account['id']}"},
    )

    updated_rows = await supabase_client.update_rows(
        "bill_payments",
        {
            "status": "completed",
            "processed_at": posted_at,
            "failure_reason": None,
            "next_run_at": None,
        },
        filters={
            "id": f"eq.{payment_id}",
            "user_id": f"eq.{current_user.id}",
        },
    )
    if not updated_rows:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update payment.",
        )
    updated_payment = updated_rows[0]

    journal = await supabase_client.insert_row(
        "ledger_journals",
        {
            "event_type": "bill_payment",
            "reference_type": "bill_payment",
            "reference_id": updated_payment["id"],
            "description": f"Bill payment to payee {updated_payment['payee_id']}",
            "created_by": current_user.id,
        },
    )

    await supabase_client.insert_row(
        "transactions",
        {
            "user_id": current_user.id,
            "account_id": updated_payment["account_id"],
            "journal_id": journal["id"],
            "type": "bill_payment",
            "direction": "out",
            "amount_cents": amount_cents,
            "description": "Bill payment",
            "status": "posted",
            "posted_at": posted_at,
            "bill_payment_id": updated_payment["id"],
        },
    )

    return updated_payment
