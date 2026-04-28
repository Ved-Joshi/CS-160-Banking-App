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
DEMO_MEMBER_TARGET_EMAIL = os.getenv("DEMO_MEMBER_TARGET_EMAIL", "behumble1907@gmail.com").strip().lower()
DEMO_MEMBER_TARGET_PASSWORD = os.getenv("DEMO_MEMBER_TARGET_PASSWORD", "DemoPass123!").strip()


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


def _create_or_login_user(
    client: httpx.Client,
    email: str,
    password: str,
    *,
    allow_existing_password_reset: bool = False,
) -> DemoUser:
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
        if create_response.status_code >= 400:
            create_error = create_response.text.lower()
            if "already been registered" not in create_error and "already exists" not in create_error:
                raise RuntimeError(
                    f"Unable to create auth user {email}: {create_response.status_code} {create_response.text}"
                )
            if allow_existing_password_reset:
                user_id = _find_auth_user_id_by_email(client, email)
                if not user_id:
                    raise RuntimeError(f"Auth user {email} exists but could not be fetched via admin API.")
                update_response = client.put(
                    f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}",
                    headers=_admin_headers(),
                    json={"password": password, "email_confirm": True},
                )
                update_response.raise_for_status()
            else:
                raise RuntimeError(
                    f"Auth user {email} already exists with a different password; refusing to reset credentials."
                )

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


def _find_auth_user_id_by_email(client: httpx.Client, email: str) -> str | None:
    response = client.get(
        f"{SUPABASE_URL}/auth/v1/admin/users",
        headers=_admin_headers(),
        params={"page": 1, "per_page": 1000},
    )
    response.raise_for_status()
    payload = response.json()
    users = payload.get("users", []) if isinstance(payload, dict) else []
    for user in users:
        if str(user.get("email") or "").strip().lower() == email:
            return str(user.get("id"))
    return None


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
    payee_names = {(payee.get("name") or "").strip().lower() for payee in payees}
    to_create: list[tuple[str, str]] = []
    if "city utilities" not in payee_names:
        to_create.append(("City Utilities", "Utilities"))
    if "acme internet" not in payee_names:
        to_create.append(("Acme Internet", "Internet"))

    for idx, (name, category) in enumerate(to_create):
        acct_num = f"{1234567890 + idx}"
        _api_post(
            client,
            "/api/payees",
            user.access_token,
            {
                "name": name,
                "category": category,
                "routingNumber": "021000021",
                "accountNumber": acct_num,
                "confirmAccountNumber": acct_num,
            },
        )
    if to_create:
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
    credit = next((acct for acct in accounts if acct.get("type") == "Credit"), None)

    transactions = _api_get(client, "/api/transactions?limit=250", user.access_token)
    if not isinstance(transactions, list):
        transactions = []

    def tx_count(*, tx_type: str | None = None, account_id: str | None = None, description_has: str | None = None) -> int:
        count = 0
        for tx in transactions:
            if tx_type and tx.get("type") != tx_type:
                continue
            if account_id and tx.get("accountId") != account_id:
                continue
            if description_has and description_has.lower() not in str(tx.get("description", "")).lower():
                continue
            count += 1
        return count

    def refresh_transactions() -> None:
        nonlocal transactions
        latest = _api_get(client, "/api/transactions?limit=250", user.access_token)
        transactions = latest if isinstance(latest, list) else []

    deposits = _api_get(client, "/api/deposits", user.access_token)
    if len(deposits) < 2:
        _api_post(
            client,
            "/api/deposits",
            user.access_token,
            {"accountId": checking["id"], "amount": 25, "depositMethod": "atm"},
            idempotent=True,
        )
    if savings and len(deposits) < 3:
        _api_post(
            client,
            "/api/deposits",
            user.access_token,
            {"accountId": savings["id"], "amount": 40, "depositMethod": "atm"},
            idempotent=True,
        )
    refresh_transactions()

    daily_exists = False
    monthly_exists = False
    payments = _api_get(client, "/api/payments", user.access_token)
    for payment in payments:
        cadence = str(payment.get("cadence") or "").lower()
        if cadence == "daily":
            daily_exists = True
        if cadence == "monthly":
            monthly_exists = True

    if payees and not monthly_exists:
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
    if payees and not daily_exists:
        daily_payee = payees[1] if len(payees) > 1 else payees[0]
        _api_post(
            client,
            "/api/payments",
            user.access_token,
            {
                "payeeId": daily_payee["id"],
                "accountId": checking["id"],
                "amount": 8.5,
                "cadence": "Daily",
                "deliverBy": date.today().isoformat(),
            },
            idempotent=True,
        )
    refresh_transactions()

    if savings:
        if tx_count(tx_type="Transfer", account_id=checking["id"]) < 2:
            _api_post(
                client,
                "/api/transfers",
                user.access_token,
                {
                    "fromAccountId": checking["id"],
                    "toAccountId": savings["id"],
                    "amount": 25,
                    "transferDate": date.today().isoformat(),
                    "memo": "Seed: Checking to savings",
                },
            )
            refresh_transactions()
        if tx_count(tx_type="Transfer", account_id=savings["id"]) < 2:
            _api_post(
                client,
                "/api/transfers",
                user.access_token,
                {
                    "fromAccountId": savings["id"],
                    "toAccountId": checking["id"],
                    "amount": 10,
                    "transferDate": date.today().isoformat(),
                    "memo": "Seed: Savings to checking",
                },
            )
            refresh_transactions()

    if credit and tx_count(tx_type="Transfer", account_id=credit["id"]) < 1:
        _api_post(
            client,
            "/api/transfers",
            user.access_token,
            {
                "fromAccountId": checking["id"],
                "toAccountId": credit["id"],
                "amount": 30,
                "transferDate": date.today().isoformat(),
                "memo": "Seed: Credit payment transfer",
            },
        )
        refresh_transactions()

    if tx_count(tx_type="ATM", account_id=checking["id"]) < 2:
        _api_post(
            client,
            "/api/withdrawals/atm",
            user.access_token,
            {"accountId": checking["id"], "amount": 20},
        )
        refresh_transactions()
    if savings and tx_count(tx_type="ATM", account_id=savings["id"]) < 1:
        _api_post(
            client,
            "/api/withdrawals/atm",
            user.access_token,
            {"accountId": savings["id"], "amount": 15},
        )
        refresh_transactions()

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


def _ensure_member_target(
    client: httpx.Client,
    email: str,
    password: str,
    *,
    allow_existing_password_reset: bool = False,
) -> DemoUser:
    recipient = _create_or_login_user(
        client,
        email,
        password,
        allow_existing_password_reset=allow_existing_password_reset,
    )
    _ensure_profile(client, recipient)
    recipient_accounts = _ensure_accounts(client, recipient)
    _set_demo_balances(client, recipient.user_id, recipient_accounts)
    return recipient


def _ensure_member_transfer_data(client: httpx.Client, sender: DemoUser) -> None:
    recipient = _ensure_member_target(
        client,
        DEMO_RECIPIENT_EMAIL,
        DEMO_RECIPIENT_PASSWORD,
        allow_existing_password_reset=True,
    )

    existing_member_plans = _api_get(client, "/api/member-transfers/plans", sender.access_token)
    existing_plan_recipient_emails = {
        str(plan.get("recipientEmail") or "").strip().lower()
        for plan in existing_member_plans
        if isinstance(plan, dict)
    }
    sender_accounts = _ensure_accounts(client, sender)
    sender_checking_id = next(
        (acct["id"] for acct in sender_accounts if acct.get("type") == "Checking"),
        sender_accounts[0]["id"],
    )

    if recipient.email not in existing_plan_recipient_emails:
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
                "memo": "Demo member transfer plan",
            },
        )

    # Immediate member transfer so transaction history shows activity with behumble account.
    transactions = _api_get(client, "/api/transactions?type=Transfer&limit=250", sender.access_token)
    if not isinstance(transactions, list):
        transactions = []
    behumble_seen = any(
        DEMO_MEMBER_TARGET_EMAIL in str(tx.get("description", "")).lower()
        for tx in transactions
    )
    if not behumble_seen:
        try:
            _api_post(
                client,
                "/api/member-transfers",
                sender.access_token,
                {
                    "fromAccountId": sender_checking_id,
                    "recipientEmail": DEMO_MEMBER_TARGET_EMAIL,
                    "amount": 18,
                    "scheduleMode": "NOW",
                    "transferDate": date.today().isoformat(),
                    "memo": f"Seed transfer to {DEMO_MEMBER_TARGET_EMAIL}",
                },
            )
        except Exception:
            # Avoid mutating or forcing credentials for real users; skip if recipient is unavailable.
            pass


def main() -> int:
    if not SEED_ENABLED:
        print("Demo seeding skipped (SEED_DEMO_DATA is disabled).")
        return 0

    _require_env()
    with httpx.Client(timeout=25) as client:
        demo_user = _create_or_login_user(
            client,
            DEMO_TEST_EMAIL,
            DEMO_TEST_PASSWORD,
            allow_existing_password_reset=True,
        )
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
