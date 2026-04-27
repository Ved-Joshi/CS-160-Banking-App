from __future__ import annotations

import os
import re
import uuid
from dataclasses import dataclass

import httpx
import pytest


SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
BACKEND_BASE_URL = os.getenv("BACKEND_BASE_URL", "http://127.0.0.1:8000")


@dataclass
class EphemeralUser:
    user_id: str
    email: str
    password: str
    access_token: str


def _require_integration_env() -> None:
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        pytest.skip("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are required for integration tests.")


async def _assert_backend_reachable() -> None:
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(f"{BACKEND_BASE_URL}/health")
        if response.status_code != 200:
            pytest.skip("Backend is not reachable for integration tests.")
    except Exception:
        pytest.skip("Backend is not reachable for integration tests.")


async def _create_auth_user(client: httpx.AsyncClient) -> EphemeralUser:
    email = f"codex-int-{uuid.uuid4().hex[:12]}@example.com"
    password = "T3st-Password!123"
    admin_headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY or "",
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }
    create_response = await client.post(
        f"{SUPABASE_URL}/auth/v1/admin/users",
        headers=admin_headers,
        json={
            "email": email,
            "password": password,
            "email_confirm": True,
        },
    )
    create_response.raise_for_status()
    user_id = create_response.json()["id"]

    token_response = await client.post(
        f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
        headers={
            "apikey": SUPABASE_SERVICE_ROLE_KEY or "",
            "Content-Type": "application/json",
        },
        json={"email": email, "password": password},
    )
    token_response.raise_for_status()
    access_token = token_response.json()["access_token"]
    return EphemeralUser(user_id=user_id, email=email, password=password, access_token=access_token)


async def _insert_profile(client: httpx.AsyncClient, user: EphemeralUser) -> None:
    existing = await client.get(
        f"{SUPABASE_URL}/rest/v1/profiles",
        params={"select": "id", "id": f"eq.{user.user_id}", "limit": "1"},
        headers={
            "apikey": SUPABASE_SERVICE_ROLE_KEY or "",
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        },
    )
    existing.raise_for_status()
    if existing.json():
        return

    suffix = uuid.uuid4().hex[:8]
    payload: dict[str, object] = {
        "id": user.user_id,
        "email": user.email.lower(),
        "username": f"codex_{suffix}",
        "first_name": "Codex",
        "last_name": "Integration",
        "mobile_phone_e164": f"+1555{uuid.uuid4().int % 10_000_000:07d}",
        "phone": f"+1555{uuid.uuid4().int % 10_000_000:07d}",
        "street_address": "1 Test Street",
        "address": "1 Test Street",
        "city": "San Jose",
        "state": "CA",
        "zip_code": "95112",
        "date_of_birth": "1995-01-01",
        "onboarding_status": "active",
        "mfa_required": False,
        "timezone": "UTC",
    }
    defaults: dict[str, object] = {
        "email": user.email.lower(),
        "username": f"codex_{suffix}",
        "first_name": "Codex",
        "last_name": "Integration",
        "mobile_phone_e164": f"+1555{uuid.uuid4().int % 10_000_000:07d}",
        "phone": f"+1555{uuid.uuid4().int % 10_000_000:07d}",
        "street_address": "1 Test Street",
        "address": "1 Test Street",
        "city": "San Jose",
        "state": "CA",
        "zip_code": "95112",
        "date_of_birth": "1995-01-01",
        "onboarding_status": "active",
        "mfa_required": False,
        "timezone": "UTC",
    }

    for _ in range(20):
        response = await client.post(
            f"{SUPABASE_URL}/rest/v1/profiles",
            headers={
                "apikey": SUPABASE_SERVICE_ROLE_KEY or "",
                "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            },
            json=payload,
        )
        if response.status_code < 400:
            return

        message = response.text
        unknown_col = re.search(r"Could not find the '([^']+)' column", message)
        if unknown_col:
            payload.pop(unknown_col.group(1), None)
            continue

        null_col = re.search(r'null value in column \"([^\"]+)\"', message)
        if null_col:
            col = null_col.group(1)
            if col in defaults:
                payload[col] = defaults[col]
                continue

        if "duplicate key value violates unique constraint" in message:
            payload["username"] = f"codex_{uuid.uuid4().hex[:8]}"
            payload["mobile_phone_e164"] = f"+1555{uuid.uuid4().int % 10_000_000:07d}"
            payload["phone"] = f"+1555{uuid.uuid4().int % 10_000_000:07d}"
            continue

        raise RuntimeError(f"Profile insert failed: {response.status_code} {response.text}")

    raise RuntimeError("Profile insert failed after adaptive retries.")


async def _create_account_via_backend(client: httpx.AsyncClient, access_token: str) -> str:
    response = await client.post(
        f"{BACKEND_BASE_URL}/api/accounts",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        },
        json={
            "nickname": f"Integration {uuid.uuid4().hex[:6]}",
            "type": "Checking",
        },
    )
    if response.status_code >= 400:
        raise RuntimeError(f"Account creation via backend failed: {response.status_code} {response.text}")
    return response.json()["id"]


async def _delete_auth_user(client: httpx.AsyncClient, user_id: str) -> None:
    response = await client.delete(
        f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}",
        headers={
            "apikey": SUPABASE_SERVICE_ROLE_KEY or "",
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        },
    )
    response.raise_for_status()


@pytest.mark.asyncio
async def test_rls_blocks_cross_user_account_reads() -> None:
    _require_integration_env()
    await _assert_backend_reachable()

    created_user_ids: list[str] = []
    async with httpx.AsyncClient(timeout=20) as client:
        try:
            owner = await _create_auth_user(client)
            created_user_ids.append(owner.user_id)
            intruder = await _create_auth_user(client)
            created_user_ids.append(intruder.user_id)

            await _insert_profile(client, owner)
            await _insert_profile(client, intruder)
            owner_account_id = await _create_account_via_backend(client, owner.access_token)

            read_response = await client.get(
                f"{SUPABASE_URL}/rest/v1/accounts",
                params={"select": "id,user_id", "id": f"eq.{owner_account_id}"},
                headers={
                    "apikey": SUPABASE_SERVICE_ROLE_KEY or "",
                    "Authorization": f"Bearer {intruder.access_token}",
                },
            )
            read_response.raise_for_status()
            assert read_response.json() == []
        finally:
            for user_id in reversed(created_user_ids):
                await _delete_auth_user(client, user_id)


@pytest.mark.asyncio
async def test_backend_prevents_deposit_to_foreign_account() -> None:
    _require_integration_env()
    await _assert_backend_reachable()

    created_user_ids: list[str] = []
    async with httpx.AsyncClient(timeout=20) as client:
        try:
            owner = await _create_auth_user(client)
            created_user_ids.append(owner.user_id)
            intruder = await _create_auth_user(client)
            created_user_ids.append(intruder.user_id)

            await _insert_profile(client, owner)
            await _insert_profile(client, intruder)
            owner_account_id = await _create_account_via_backend(client, owner.access_token)

            response = await client.post(
                f"{BACKEND_BASE_URL}/api/deposits",
                headers={
                    "Authorization": f"Bearer {intruder.access_token}",
                    "Idempotency-Key": str(uuid.uuid4()),
                },
                json={
                    "accountId": owner_account_id,
                    "amount": 25,
                    "depositMethod": "atm",
                },
            )
            assert response.status_code == 404
            assert "account not found" in response.text.lower()
        finally:
            for user_id in reversed(created_user_ids):
                await _delete_auth_user(client, user_id)
