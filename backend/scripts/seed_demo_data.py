from __future__ import annotations

import os
import sys
import uuid
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

import httpx


SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
BACKEND_BASE_URL = os.getenv("BACKEND_BASE_URL", "http://backend:8000").rstrip("/")

SEED_ENABLED = os.getenv("SEED_DEMO_DATA", "true").lower() in {"1", "true", "yes", "on"}
DEMO_TEST_EMAIL = os.getenv("DEMO_TEST_EMAIL", "demo.tester@example.com").strip().lower()
DEMO_TEST_PASSWORD = os.getenv("DEMO_TEST_PASSWORD", "DemoPass123!").strip()
DEMO_RECIPIENT_EMAIL = os.getenv("DEMO_RECIPIENT_EMAIL", "demo.recipient@example.com").strip().lower()
DEMO_RECIPIENT_PASSWORD = os.getenv("DEMO_RECIPIENT_PASSWORD", "DemoPass123!").strip()


@dataclass
class DemoUser:
    user_id: str
    email: str
    password: str
    access_token: str


def _require_env() -> None:
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for demo seeding.")


def _admin_headers() -> dict[str, str]:
    return {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }


def _service_rest_headers() -> dict[str, str]:
    return {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
    }


def _auth_headers(access_token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }


def _create_or_login_user(client: httpx.Client, email: str, password: str) -> DemoUser:
    token_response = client.post(
        f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
        headers={"apikey": SUPABASE_SERVICE_ROLE_KEY, "Content-Type": "application/json"},
        json={"email": email, "password": password},
    )

    if token_response.status_code >= 400:
        create_response = client.post(
            f"{SUPABASE_URL}/auth/v1/admin/users",
            headers=_admin_headers(),
            json={"email": email, "password": password, "email_confirm": True},
        )
        if create_response.status_code >= 400 and "already been registered" not in create_response.text:
            raise RuntimeError(f"Unable to create auth user {email}: {create_response.status_code} {create_response.text}")

        token_response = client.post(
            f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
            headers={"apikey": SUPABASE_SERVICE_ROLE_KEY, "Content-Type": "application/json"},
            json={"email": email, "password": password},
        )

    token_response.raise_for_status()
    payload = token_response.json()
    user = payload.get("user") or {}
    access_token = payload.get("access_token")
    if not access_token or not user.get("id"):
        raise RuntimeError(f"Unable to obtain auth token for {email}.")
    return DemoUser(user_id=user["id"], email=email, password=password, access_token=access_token)


def _ensure_profile(client: httpx.Client, user: DemoUser) -> None:
    existing = client.get(
        f"{SUPABASE_URL}/rest/v1/profiles",
        headers=_service_rest_headers(),
        params={"select": "id", "id": f"eq.{user.user_id}", "limit": "1"},
    )
    existing.raise_for_status()
    if existing.json():
        return

    suffix = uuid.uuid4().hex[:8]
    payload = {
        "id": user.user_id,
        "email": user.email,
        "first_name": "Demo",
        "last_name": "Tester",
        "phone": f"+1555{uuid.uuid4().int % 10_000_000:07d}",
        "address": "1 Demo Street, San Jose, CA 95112",
        "city": "San Jose",
        "state": "CA",
        "zip_code": "95112",
        "timezone": "America/Los_Angeles",
    }
    # Handle schema drift between migrations by attempting common optional fields.
    candidate_fields = {
        "username": f"demo_{suffix}",
        "mobile_phone_e164": payload["phone"],
        "street_address": "1 Demo Street",
        "date_of_birth": "1995-01-01",
        "onboarding_status": "active",
        "mfa_required": False,
    }

    for key, value in candidate_fields.items():
        payload[key] = value

    for _ in range(20):
        insert = client.post(
            f"{SUPABASE_URL}/rest/v1/profiles",
            headers={**_admin_headers(), "Prefer": "return=minimal"},
            json=payload,
        )
        if insert.status_code < 400:
            return
        text = insert.text
        marker = "Could not find the '"
        if marker in text and "' column" in text:
            col = text.split(marker, 1)[1].split("' column", 1)[0]
            payload.pop(col, None)
            continue
        if "duplicate key value violates unique constraint" in text:
            payload["username"] = f"demo_{uuid.uuid4().hex[:8]}"
            payload["mobile_phone_e164"] = f"+1555{uuid.uuid4().int % 10_000_000:07d}"
            payload["phone"] = f"+1555{uuid.uuid4().int % 10_000_000:07d}"
            continue
        if 'null value in column "' in text:
            col = text.split('null value in column "', 1)[1].split('"', 1)[0]
            if col == "street_address":
                payload[col] = "1 Demo Street"
                continue
            if col == "mobile_phone_e164":
                payload[col] = f"+1555{uuid.uuid4().int % 10_000_000:07d}"
                continue
        raise RuntimeError(f"Unable to insert profile for {user.email}: {insert.status_code} {insert.text}")

    raise RuntimeError(f"Unable to insert profile for {user.email}: exhausted retries.")


def _api_get(client: httpx.Client, path: str, access_token: str) -> Any:
    response = client.get(f"{BACKEND_BASE_URL}{path}", headers=_auth_headers(access_token))
    response.raise_for_status()
    return response.json()


def _api_post(client: httpx.Client, path: str, access_token: str, payload: dict[str, Any], *, idempotent: bool = False) -> Any:
    headers = _auth_headers(access_token)
    if idempotent:
        headers["Idempotency-Key"] = str(uuid.uuid4())
    response = client.post(f"{BACKEND_BASE_URL}{path}", headers=headers, json=payload)
    response.raise_for_status()
    if response.status_code == 204 or not response.text:
        return None
    return response.json()


def _ensure_accounts(client: httpx.Client, user: DemoUser) -> list[dict[str, Any]]:
    accounts = _api_get(client, "/api/accounts", user.access_token)
    if not isinstance(accounts, list):
        raise RuntimeError("Unexpected accounts response format.")

    needed = []
    if not any(acct.get("type") == "Checking" for acct in accounts):
        needed.append(("Everyday Checking", "Checking"))
    if not any(acct.get("type") == "Savings" for acct in accounts):
        needed.append(("Rainy Day Savings", "Savings"))
    if not any(acct.get("type") == "Credit" for acct in accounts):
        needed.append(("Rewards Credit", "Credit"))

    for nickname, acct_type in needed:
        _api_post(client, "/api/accounts", user.access_token, {"nickname": nickname, "type": acct_type})

    accounts = _api_get(client, "/api/accounts", user.access_token)
    if not accounts:
        raise RuntimeError("Demo user has no accounts after seeding.")
    return accounts


def _set_demo_balances(client: httpx.Client, user_id: str, accounts: list[dict[str, Any]]) -> None:
    for account in accounts:
        account_type = account.get("type")
        cents = 0
        if account_type == "Checking":
            cents = 250_000
        elif account_type == "Savings":
            cents = 640_000
        elif account_type == "Credit":
            cents = -50_000
        response = client.patch(
            f"{SUPABASE_URL}/rest/v1/accounts",
            headers={**_admin_headers(), "Prefer": "return=minimal"},
            params={"id": f"eq.{account['id']}", "user_id": f"eq.{user_id}"},
            json={"available_balance_cents": cents, "current_balance_cents": cents},
        )
        response.raise_for_status()


def _ensure_payee(client: httpx.Client, user: DemoUser) -> list[dict[str, Any]]:
    payees = _api_get(client, "/api/payees", user.access_token)
    if not payees:
        _api_post(
            client,
            "/api/payees",
            user.access_token,
            {
                "name": "City Utilities",
                "category": "Utilities",
                "routingNumber": "021000021",
                "accountNumber": "1234567890",
                "confirmAccountNumber": "1234567890",
            },
        )
        payees = _api_get(client, "/api/payees", user.access_token)
    return payees


def _ensure_external_account(client: httpx.Client, user: DemoUser) -> list[dict[str, Any]]:
    external_accounts = _api_get(client, "/api/external-accounts", user.access_token)
    if not external_accounts:
        suffix = f"{uuid.uuid4().int % 10_000_000_000:010d}"
        _api_post(
            client,
            "/api/external-accounts",
            user.access_token,
            {
                "bankName": "Demo External Bank",
                "nickname": "Travel Fund",
                "accountType": "Checking",
                "routingNumber": "011000015",
                "accountNumber": suffix,
                "confirmAccountNumber": suffix,
            },
        )
        external_accounts = _api_get(client, "/api/external-accounts", user.access_token)
    return external_accounts


def _seed_money_flows(
    client: httpx.Client,
    user: DemoUser,
    accounts: list[dict[str, Any]],
    payees: list[dict[str, Any]],
    external_accounts: list[dict[str, Any]],
) -> None:
    checking = next((acct for acct in accounts if acct.get("type") == "Checking"), accounts[0])
    savings = next((acct for acct in accounts if acct.get("type") == "Savings"), None)

    deposits = _api_get(client, "/api/deposits", user.access_token)
    if not deposits:
        _api_post(
            client,
            "/api/deposits",
            user.access_token,
            {"accountId": checking["id"], "amount": 25, "depositMethod": "atm"},
            idempotent=True,
        )

    payments = _api_get(client, "/api/payments", user.access_token)
    if not payments and payees:
        _api_post(
            client,
            "/api/payments",
            user.access_token,
            {
                "payeeId": payees[0]["id"],
                "accountId": checking["id"],
                "amount": 19.95,
                "cadence": "Monthly",
                "deliverBy": (date.today() + timedelta(days=1)).isoformat(),
            },
            idempotent=True,
        )

    if savings:
        transactions = _api_get(client, "/api/transactions?limit=5", user.access_token)
        if not transactions:
            _api_post(
                client,
                "/api/transfers",
                user.access_token,
                {
                    "fromAccountId": checking["id"],
                    "toAccountId": savings["id"],
                    "amount": 15,
                    "transferDate": date.today().isoformat(),
                    "memo": "Initial demo transfer",
                },
            )

    if external_accounts:
        external_transfers = _api_get(client, "/api/external-transfers", user.access_token)
        if not external_transfers:
            _api_post(
                client,
                "/api/external-transfers",
                user.access_token,
                {
                    "fromAccountId": checking["id"],
                    "externalAccountId": external_accounts[0]["id"],
                    "amount": 12,
                    "transferDate": date.today().isoformat(),
                    "scheduleMode": "NOW",
                    "memo": "Demo external transfer",
                },
            )


def _ensure_member_transfer_data(client: httpx.Client, sender: DemoUser) -> None:
    recipient = _create_or_login_user(client, DEMO_RECIPIENT_EMAIL, DEMO_RECIPIENT_PASSWORD)
    _ensure_profile(client, recipient)
    recipient_accounts = _ensure_accounts(client, recipient)
    _set_demo_balances(client, recipient.user_id, recipient_accounts)

    existing_member_plans = _api_get(client, "/api/member-transfers/plans", sender.access_token)
    if existing_member_plans:
        return
    sender_accounts = _ensure_accounts(client, sender)
    sender_checking_id = next(
        (acct["id"] for acct in sender_accounts if acct.get("type") == "Checking"),
        sender_accounts[0]["id"],
    )

    _api_post(
        client,
        "/api/member-transfers",
        sender.access_token,
        {
            "fromAccountId": sender_checking_id,
            "recipientEmail": recipient.email,
            "amount": 10,
            "scheduleMode": "SCHEDULED",
            "cadence": "Once",
            "startDate": (date.today() + timedelta(days=1)).isoformat(),
            "runTime": "09:30",
            "timezone": "America/Los_Angeles",
            "memo": "Demo member transfer",
        },
    )


def main() -> int:
    if not SEED_ENABLED:
        print("Demo seeding skipped (SEED_DEMO_DATA is disabled).")
        return 0

    _require_env()
    with httpx.Client(timeout=25) as client:
        demo_user = _create_or_login_user(client, DEMO_TEST_EMAIL, DEMO_TEST_PASSWORD)
        _ensure_profile(client, demo_user)
        accounts = _ensure_accounts(client, demo_user)
        _set_demo_balances(client, demo_user.user_id, accounts)
        payees = _ensure_payee(client, demo_user)
        external_accounts = _ensure_external_account(client, demo_user)
        _seed_money_flows(client, demo_user, accounts, payees, external_accounts)
        _ensure_member_transfer_data(client, demo_user)

    print("Demo seed complete.")
    print(f"Tester login: {DEMO_TEST_EMAIL}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"Demo seed failed: {exc}", file=sys.stderr)
        raise
