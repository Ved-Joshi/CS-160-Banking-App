import pytest
from fastapi import HTTPException

from routers.banking_read import _ensure_bill_payment_funds_or_raise


def test_ensure_bill_payment_funds_accepts_amount_within_available_balance() -> None:
    _ensure_bill_payment_funds_or_raise({"available_balance_cents": 5_000}, 4_999)


def test_ensure_bill_payment_funds_rejects_amount_above_available_balance() -> None:
    with pytest.raises(HTTPException) as exc:
        _ensure_bill_payment_funds_or_raise({"available_balance_cents": 5_000}, 5_001)
    assert exc.value.status_code == 400
    assert exc.value.detail == "Payment amount cannot exceed the account's available balance."
