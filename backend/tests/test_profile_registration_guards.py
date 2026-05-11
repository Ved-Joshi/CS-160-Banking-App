import pytest
from fastapi import HTTPException, status

from routers.banking_read import (
    ACCOUNT_OPENING_PROFILE_ERROR,
    ensure_profile_ready_for_account_creation,
    is_duplicate_phone_conflict,
    is_profile_ready_for_account_creation,
)


def test_duplicate_phone_conflict_detection_matches_unique_constraint_errors() -> None:
    exc = HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail='duplicate key value violates unique constraint "profiles_mobile_unique"',
    )

    assert is_duplicate_phone_conflict(exc) is True


def test_duplicate_phone_conflict_detection_ignores_other_errors() -> None:
    exc = HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Phone number must contain exactly 10 digits.",
    )

    assert is_duplicate_phone_conflict(exc) is False


def test_profile_readiness_requires_all_registration_fields() -> None:
    profile = {
        "email": "member@example.com",
        "first_name": "Raymond",
        "last_name": "Wang",
        "mobile_phone_e164": "+15101111111",
        "street_address": "123 Main Street",
        "city": "San Jose",
        "state": "CA",
        "zip_code": "95112",
        "date_of_birth": "1995-01-01",
        "onboarding_status": "active",
    }

    assert is_profile_ready_for_account_creation(profile) is True

    incomplete = dict(profile)
    incomplete["street_address"] = "   "

    assert is_profile_ready_for_account_creation(incomplete) is False


def test_account_creation_guard_blocks_incomplete_profiles() -> None:
    with pytest.raises(HTTPException) as exc:
        ensure_profile_ready_for_account_creation(
            {
                "email": "member@example.com",
                "first_name": "Raymond",
                "last_name": "Wang",
                "mobile_phone_e164": "+15101111111",
                "street_address": "",
                "city": "San Jose",
                "state": "CA",
                "zip_code": "95112",
                "date_of_birth": "1995-01-01",
                "onboarding_status": "active",
            }
        )

    assert exc.value.status_code == status.HTTP_400_BAD_REQUEST
    assert exc.value.detail == ACCOUNT_OPENING_PROFILE_ERROR


def test_account_creation_guard_blocks_non_active_profiles() -> None:
    with pytest.raises(HTTPException) as exc:
        ensure_profile_ready_for_account_creation(
            {
                "email": "member@example.com",
                "first_name": "Raymond",
                "last_name": "Wang",
                "mobile_phone_e164": "+15101111111",
                "street_address": "123 Main Street",
                "city": "San Jose",
                "state": "CA",
                "zip_code": "95112",
                "date_of_birth": "1995-01-01",
                "onboarding_status": "mfa_pending",
            }
        )

    assert exc.value.status_code == status.HTTP_400_BAD_REQUEST
    assert exc.value.detail == ACCOUNT_OPENING_PROFILE_ERROR
