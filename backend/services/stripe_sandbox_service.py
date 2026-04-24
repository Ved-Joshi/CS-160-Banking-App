from __future__ import annotations

import json
from typing import Any

import httpx
from fastapi import HTTPException, status

from config import settings

STRIPE_API_BASE = "https://api.stripe.com/v1"


def _require_stripe_keys() -> tuple[str, str]:
    secret_key = (settings.STRIPE_SECRET_KEY or "").strip()
    publishable_key = (settings.STRIPE_PUBLISHABLE_KEY or "").strip()
    if not secret_key or not publishable_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Stripe sandbox is not configured. Set STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY.",
        )
    return secret_key, publishable_key


async def _stripe_request(
    method: str,
    path: str,
    *,
    data: dict[str, Any] | None = None,
    params: dict[str, str] | None = None,
) -> dict[str, Any]:
    secret_key, _ = _require_stripe_keys()
    url = f"{STRIPE_API_BASE}{path}"
    headers = {
        "Authorization": f"Bearer {secret_key}",
    }
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(20.0)) as client:
            response = await client.request(method, url, data=data, params=params, headers=headers)
        response.raise_for_status()
        return response.json()
    except httpx.HTTPStatusError as exc:
        detail = "Stripe request failed."
        try:
            payload = exc.response.json()
            error = payload.get("error") or {}
            detail = error.get("message") or detail
        except (ValueError, json.JSONDecodeError):
            pass
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=detail) from exc
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unable to reach Stripe sandbox: {exc}",
        ) from exc


async def create_stripe_customer_for_linking(email: str | None) -> str:
    payload: dict[str, Any] = {}
    if email and email.strip():
        payload["email"] = email.strip().lower()
    customer = await _stripe_request("POST", "/customers", data=payload)
    customer_id = customer.get("id")
    if not isinstance(customer_id, str) or not customer_id:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Stripe did not return a customer id.")
    return customer_id


async def create_financial_connections_session(*, customer_id: str) -> dict[str, str]:
    _, publishable_key = _require_stripe_keys()
    session = await _stripe_request(
        "POST",
        "/financial_connections/sessions",
        data={
            "account_holder[type]": "customer",
            "account_holder[customer]": customer_id,
            "permissions[]": "payment_method",
            "permissions[]": "ownership",
            "filters[countries][]": "US",
        },
    )
    client_secret = session.get("client_secret")
    session_id = session.get("id")
    if not isinstance(client_secret, str) or not client_secret:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Stripe did not return a session client secret.")
    if not isinstance(session_id, str) or not session_id:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Stripe did not return a session id.")
    return {
        "clientSecret": client_secret,
        "sessionId": session_id,
        "publishableKey": publishable_key,
        "customerId": customer_id,
    }


async def get_financial_connections_account(account_id: str) -> dict[str, Any]:
    account = await _stripe_request(
        "GET",
        f"/financial_connections/accounts/{account_id}",
        params={"expand[]": "institution"},
    )
    account_id_value = account.get("id")
    if not isinstance(account_id_value, str) or not account_id_value:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Stripe returned an invalid account.")
    return account
