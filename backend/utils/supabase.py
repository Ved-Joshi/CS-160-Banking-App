import json
import random
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Iterable, Optional
from urllib.parse import parse_qs, quote, urlencode, urlparse

import httpx

from fastapi import HTTPException, status

from config import settings


def cents_to_amount(value: Optional[int]) -> float:
    cents = Decimal(value or 0)
    return float((cents / Decimal("100")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def amount_to_cents(value: float) -> int:
    return int((Decimal(str(value)) * Decimal("100")).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def random_last4() -> str:
    return f"{random.randint(0, 9999):04d}"


@dataclass
class SupabaseUser:
    id: str
    email: str
    user_metadata: dict[str, Any]
    phone: Optional[str]
    created_at: str


class SupabaseClient:
    def __init__(self) -> None:
        self.base_url = settings.SUPABASE_URL
        self.service_role_key = settings.SUPABASE_SERVICE_ROLE_KEY

    def ensure_configured(self) -> None:
        if self.base_url and self.service_role_key:
            return
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Supabase backend configuration is missing. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
        )

    async def _request(
        self,
        method: str,
        path: str,
        *,
        auth_token: Optional[str] = None,
        query: Optional[Iterable[tuple[str, str]]] = None,
        body: Optional[dict[str, Any]] = None,
        prefer: Optional[str] = None,
        extra_headers: Optional[dict[str, str]] = None,
    ) -> Any:
        self.ensure_configured()
        url = f"{self.base_url}{path}"
        if query:
            encoded_query = urlencode(list(query))
            if encoded_query:
                url = f"{url}?{encoded_query}"

        headers = {
            "apikey": self.service_role_key or "",
            "Authorization": f"Bearer {auth_token or self.service_role_key}",
            "Accept": "application/json",
        }
        if prefer:
            headers["Prefer"] = prefer
        if extra_headers:
            headers.update(extra_headers)

        payload = None
        if body is not None:
            payload = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"

        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(20.0)) as client:
                response = await client.request(method, url, content=payload, headers=headers)
            response.raise_for_status()
            if not response.text:
                return None
            return response.json()
        except httpx.HTTPStatusError as exc:
            detail: Any = exc.response.reason_phrase
            try:
                payload = exc.response.json()
                detail = payload.get("message") or payload.get("msg") or payload
            except ValueError:
                pass
            raise HTTPException(status_code=exc.response.status_code, detail=detail) from exc
        except httpx.TimeoutException as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Supabase request timed out.",
            ) from exc
        except httpx.RequestError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Unable to reach Supabase: {exc}",
            ) from exc

    async def get_authenticated_user(self, access_token: str) -> SupabaseUser:
        payload = await self._request("GET", "/auth/v1/user", auth_token=access_token)
        return SupabaseUser(
            id=payload["id"],
            email=payload.get("email") or "",
            user_metadata=payload.get("user_metadata") or {},
            phone=payload.get("phone"),
            created_at=payload.get("created_at") or "",
        )

    async def select_rows(
        self,
        table: str,
        *,
        select: str = "*",
        filters: Optional[dict[str, str]] = None,
        order: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> list[dict[str, Any]]:
        query: list[tuple[str, str]] = [("select", select)]
        if filters:
            for key, value in filters.items():
                query.append((key, value))
        if order:
            query.append(("order", order))
        if limit is not None:
            query.append(("limit", str(limit)))
        return await self._request("GET", f"/rest/v1/{table}", query=query) or []

    async def insert_row(self, table: str, values: dict[str, Any]) -> dict[str, Any]:
        rows = await self._request(
            "POST",
            f"/rest/v1/{table}",
            body=values,
            prefer="return=representation",
        ) or []
        if not rows:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Supabase did not return the created {table} row.",
            )
        return rows[0]

    async def update_rows(
        self,
        table: str,
        values: dict[str, Any],
        *,
        filters: dict[str, str],
    ) -> list[dict[str, Any]]:
        query: list[tuple[str, str]] = []
        for key, value in filters.items():
            query.append((key, value))
        rows = await self._request(
            "PATCH",
            f"/rest/v1/{table}",
            query=query,
            body=values,
            prefer="return=representation",
        ) or []
        return rows

    async def create_signed_upload_url(
        self,
        bucket: str,
        path: str,
        *,
        upsert: bool = False,
    ) -> dict[str, Any]:
        encoded_path = quote(path, safe="/")
        response = await self._request(
            "POST",
            f"/storage/v1/object/upload/sign/{bucket}/{encoded_path}",
            body={},
            extra_headers={"x-upsert": "true"} if upsert else None,
        )
        relative_url = response.get("url") or ""
        parsed = urlparse(relative_url)
        token = parse_qs(parsed.query).get("token", [""])[0]
        return {
            "path": path,
            "token": token,
            "signedUrl": f"{self.base_url}/storage/v1{relative_url}",
        }

    async def rpc(self, function_name: str, values: dict[str, Any]) -> Any:
        return await self._request(
            "POST",
            f"/rest/v1/rpc/{function_name}",
            body=values,
        )


supabase_client = SupabaseClient()
