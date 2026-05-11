from routers.admin import map_account as map_admin_account
from routers.banking_read import map_account


def test_banking_account_mapping_hides_routing_number_for_credit_accounts() -> None:
    account = map_account(
        {
            "id": "acct_credit_1",
            "nickname": "Travel Credit",
            "account_type": "credit",
            "account_last4": "4321",
            "routing_number": "121000358",
            "status": "open",
            "opened_at": "2026-05-01T00:00:00Z",
            "available_balance_cents": 0,
            "current_balance_cents": 0,
        }
    )

    assert account.type == "Credit"
    assert account.routingNumber is None


def test_admin_account_mapping_hides_routing_number_for_credit_accounts() -> None:
    account = map_admin_account(
        {
            "id": "acct_credit_2",
            "nickname": "Rewards Credit",
            "account_type": "credit",
            "account_last4": "9876",
            "routing_number": "121000358",
            "status": "open",
            "opened_at": "2026-05-01T00:00:00Z",
            "available_balance_cents": 0,
            "current_balance_cents": 0,
            "close_eligible": False,
        }
    )

    assert account.type == "Credit"
    assert account.routingNumber is None
