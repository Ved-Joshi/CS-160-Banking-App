import pytest
from fastapi import HTTPException

from routers import banking_read
from schemas.banking import CreatePayeeIn
from utils.supabase import SupabaseUser


@pytest.mark.asyncio
async def test_create_payee_rejects_unknown_account_number(monkeypatch: pytest.MonkeyPatch) -> None:
    current_user = SupabaseUser(
        id="user-1",
        email="user@example.com",
        user_metadata={},
        app_metadata={},
        phone=None,
        created_at="2026-01-01T00:00:00Z",
    )
    payload = CreatePayeeIn(
        name="Comcast",
        category="Internet",
        routingNumber="021000021",
        accountNumber="999999999",
        confirmAccountNumber="999999999",
    )

    async def fake_validation_failure(payee: dict) -> str | None:
        assert payee == {
            "routing_number": "021000021",
            "account_number": "999999999",
        }
        return "Payee account number could not be verified for that routing number."

    async def fake_insert_row(*args, **kwargs):
        raise AssertionError("Payee should not be inserted when validation fails.")

    monkeypatch.setattr(banking_read, "get_payee_account_validation_failure", fake_validation_failure)
    monkeypatch.setattr(banking_read.supabase_client, "insert_row", fake_insert_row)

    with pytest.raises(HTTPException) as exc:
        await banking_read.create_payee(payload, current_user)

    assert exc.value.status_code == 400
    assert exc.value.detail == "Payee account number could not be verified for that routing number."
