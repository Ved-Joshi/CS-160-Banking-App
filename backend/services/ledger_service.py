"""
Lightweight ledger write-through support for banking operations.

This module provides helpers to ensure ledger accounts are created and maintained
in sync with customer bank accounts, without refactoring the system to ledger-first.
"""

from fastapi import HTTPException, status

from utils.supabase import supabase_client


def generate_ledger_code(account_id: str) -> str:
    """
    Generate a unique ledger code for a customer account.
    
    Format: CUST_ACCT_<account-id-without-hyphens>
    
    Args:
        account_id: The customer account UUID
        
    Returns:
        A unique ledger code string
    """
    return f"CUST_ACCT_{account_id.replace('-', '')}"


async def ensure_customer_ledger_account(account: dict) -> dict:
    """
    Ensure a ledger account exists for a customer bank account.
    
    Creates a linked ledger account with:
    - owner_type = "customer"
    - owner_user_id = account.user_id
    - product_account_id = account.id
    - account_class = "liability"
    - normal_balance = "credit"
    - currency = "USD"
    - is_active = true
    
    This is idempotent: if the ledger account already exists, it is returned unchanged.
    The product_account_id foreign key ensures one-to-one linkage.
    
    Args:
        account: The bank account dict (must have id, user_id, nickname)
        
    Returns:
        The ledger account dict
        
    Raises:
        HTTPException: If creation or lookup fails
    """
    ledger_code = generate_ledger_code(account["id"])
    
    # Try to select existing ledger account (fast path for idempotence)
    existing_rows = await supabase_client.select_rows(
        "ledger_accounts",
        filters={"product_account_id": f"eq.{account['id']}"},
        limit=1,
    )
    
    if existing_rows:
        return existing_rows[0]
    
    # Create new ledger account
    ledger_account_payload = {
        "owner_type": "customer",
        "owner_user_id": account["user_id"],
        "product_account_id": account["id"],
        "ledger_code": ledger_code,
        "name": account.get("nickname") or "Customer Account",
        "account_class": "liability",
        "normal_balance": "credit",
        "currency": "USD",
        "is_active": True,
    }
    
    try:
        ledger_account = await supabase_client.insert_row("ledger_accounts", ledger_account_payload)
        return ledger_account
    except HTTPException as exc:
        # If it fails due to duplicate ledger_code (race condition), fetch and return it
        if "duplicate" in str(exc.detail).lower() or "unique" in str(exc.detail).lower():
            rows = await supabase_client.select_rows(
                "ledger_accounts",
                filters={"ledger_code": f"eq.{ledger_code}"},
                limit=1,
            )
            if rows:
                return rows[0]
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create ledger account: {exc.detail}",
        ) from exc


async def _get_or_create_bank_ledger_account(
    *,
    ledger_code: str,
    name: str,
    account_class: str,
    normal_balance: str,
) -> dict:
    """
    Ensure a bank-owned ledger account exists.

    This helper is used for operational clearing accounts that support
    write-through ledger flows like bill pay and deposits.
    """
    ledger_account_payload = {
        "owner_type": "bank",
        "owner_user_id": None,
        "product_account_id": None,
        "ledger_code": ledger_code,
        "name": name,
        "account_class": account_class,
        "normal_balance": normal_balance,
        "currency": "USD",
        "is_active": True,
    }

    existing_rows = await supabase_client.select_rows(
        "ledger_accounts",
        filters={"ledger_code": f"eq.{ledger_code}"},
        limit=1,
    )
    if existing_rows:
        updated_rows = await supabase_client.update_rows(
            "ledger_accounts",
            ledger_account_payload,
            filters={"ledger_code": f"eq.{ledger_code}"},
        )
        return updated_rows[0] if updated_rows else existing_rows[0]

    try:
        ledger_account = await supabase_client.insert_row("ledger_accounts", ledger_account_payload)
        return ledger_account
    except HTTPException as exc:
        if "duplicate" in str(exc.detail).lower() or "unique" in str(exc.detail).lower():
            rows = await supabase_client.select_rows(
                "ledger_accounts",
                filters={"ledger_code": f"eq.{ledger_code}"},
                limit=1,
            )
            if rows:
                return rows[0]
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create {name.lower()} ledger account: {exc.detail}",
        ) from exc


async def get_or_create_billpay_clearing_ledger_account() -> dict:
    """
    Ensure the bank-owned bill payment clearing ledger account exists.

    This account is used as the offsetting side for bill payment journals.
    The helper is idempotent so it can safely run before every bill payment
    execution path.
    """
    return await _get_or_create_bank_ledger_account(
        ledger_code="BANK_BILLPAY_CLEARING_USD",
        name="Bill Pay Clearing",
        account_class="liability",
        normal_balance="credit",
    )


async def get_or_create_deposit_clearing_ledger_account() -> dict:
    """
    Ensure the bank-owned deposit clearing ledger account exists.

    Deposit write-through already runs in the SQL RPC, but the backend
    validates this clearing account exists before invoking the RPC so the
    operation fails fast with a clearer error if ledger setup is missing.
    """
    return await _get_or_create_bank_ledger_account(
        ledger_code="DEPOSIT_CLEARING",
        name="Deposit Clearing",
        account_class="asset",
        normal_balance="debit",
    )


async def get_or_create_bank_vault_cash_ledger_account() -> dict:
    """
    Ensure the bank-owned cash ledger account exists.

    ATM withdrawals post against bank vault cash, so the backend checks this
    account exists before calling the withdrawal RPC.
    """
    return await _get_or_create_bank_ledger_account(
        ledger_code="BANK_VAULT_CASH",
        name="Bank Vault Cash",
        account_class="asset",
        normal_balance="debit",
    )


async def ensure_ledger_accounts_for_transfer(
    from_account: dict,
    to_account: dict,
) -> tuple[dict, dict]:
    """
    Ensure ledger accounts exist for both accounts in a transfer.
    
    This is called as a safety check before a transfer is executed.
    In normal operation, ledger accounts should already exist from account creation,
    but this ensures they're present if account creation happened outside the normal flow.
    
    Args:
        from_account: Source account dict
        to_account: Destination account dict
        
    Returns:
        Tuple of (from_ledger_account, to_ledger_account)
    """
    from_ledger = await ensure_customer_ledger_account(from_account)
    to_ledger = await ensure_customer_ledger_account(to_account)
    return from_ledger, to_ledger
