import pytest

from services import payment_service


@pytest.mark.asyncio
async def test_get_payee_account_validation_failure_rejects_unknown_account(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_select_rows(table: str, **kwargs):
        assert table == "accounts"
        return []

    monkeypatch.setattr(payment_service.supabase_client, "select_rows", fake_select_rows)

    failure = await payment_service.get_payee_account_validation_failure(
        {
            "routing_number": "021000021",
            "account_number": "123456789",
        }
    )

    assert failure == "Payee account number could not be verified for that routing number."


@pytest.mark.asyncio
async def test_attempt_payment_run_fails_before_rpc_when_payee_account_is_invalid(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_select_rows(table: str, **kwargs):
        if table == "payees":
            return [
                {
                    "id": "payee-1",
                    "routing_number": "021000021",
                    "account_number": "999999999",
                }
            ]
        if table == "accounts":
            filters = kwargs.get("filters") or {}
            if "routing_number" in filters:
                return []
            raise AssertionError("Funding account lookup should not run when payee validation fails.")
        raise AssertionError(f"Unexpected table lookup: {table}")

    async def fake_rpc(*args, **kwargs):
        raise AssertionError("RPC should not run when payee validation fails.")

    monkeypatch.setattr(payment_service.supabase_client, "select_rows", fake_select_rows)
    monkeypatch.setattr(payment_service.supabase_client, "rpc", fake_rpc)

    succeeded, failure_reason = await payment_service.attempt_payment_run(
        {
            "id": "payment-1",
            "user_id": "user-1",
            "payee_id": "payee-1",
            "account_id": "funding-1",
            "amount_cents": 2500,
        }
    )

    assert succeeded is False
    assert failure_reason == "Payee account number could not be verified for that routing number."
