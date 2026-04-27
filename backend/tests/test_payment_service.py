import pytest
from fastapi import HTTPException, status

from services import payment_service


@pytest.mark.asyncio
async def test_set_payment_failure_notification_ignores_duplicate_insert(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _raise_duplicate(*args, **kwargs):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="duplicate key")

    monkeypatch.setattr(payment_service.supabase_client, "insert_row", _raise_duplicate)

    # Should not raise: duplicate dedupe-key inserts are expected and ignored.
    await payment_service._set_payment_failure_notification(
        user_id="user_1",
        bill_payment_id="payment_1",
        timezone_name="UTC",
        title="Payment could not be processed",
        body="Insufficient balance.",
    )


@pytest.mark.asyncio
async def test_validate_payment_amount_or_raise() -> None:
    payment_service.validate_payment_amount_or_raise(10.25)

    with pytest.raises(HTTPException) as too_many_decimals:
        payment_service.validate_payment_amount_or_raise(1.999)
    assert too_many_decimals.value.status_code == 400

    with pytest.raises(HTTPException) as too_large:
        payment_service.validate_payment_amount_or_raise(1000000.0)
    assert too_large.value.status_code == 400
