from schemas.banking import Transaction
from utils.supabase import SupabaseUser, cents_to_amount, supabase_client


def _is_admin(current_user: SupabaseUser) -> bool:
    roles = current_user.app_metadata.get("roles") or current_user.user_metadata.get("roles") or []
    return isinstance(roles, list) and "admin" in roles


def _map_transaction_type(db_value: str) -> str:
    mapping = {
        "transfer": "Transfer",
        "bill_payment": "Bill Pay",
        "deposit": "Deposit",
        "fee": "ATM",
        "interest": "Interest",
        "adjustment": "Withdrawal",
    }
    return mapping.get(db_value, "Transfer")


def _map_transaction_status(db_value: str) -> str:
    mapping = {
        "pending": "PENDING",
        "posted": "COMPLETED",
        "failed": "FAILED",
        "reversed": "FAILED",
    }
    return mapping.get(db_value, "PENDING")


def _map_transaction_direction(db_value: str) -> str:
    return "credit" if db_value == "in" else "debit"


async def list_transactions_for_user(current_user: SupabaseUser) -> list[Transaction]:
    if _is_admin(current_user):
        rows = await supabase_client.select_rows(
            "transactions",
            order="created_at.desc",
        )
    else:
        rows = await supabase_client.select_rows(
            "transactions",
            filters={"user_id": f"eq.{current_user.id}"},
            order="created_at.desc",
        )

    return [
        Transaction(
            id=row["id"],
            accountId=row["account_id"],
            description=row.get("description") or _map_transaction_type(row["type"]),
            amount=cents_to_amount(row["amount_cents"]),
            direction=_map_transaction_direction(row["direction"]),
            status=_map_transaction_status(row["status"]),
            type=_map_transaction_type(row["type"]),
            postedAt=row.get("posted_at") or row["created_at"],
        )
        for row in rows
    ]