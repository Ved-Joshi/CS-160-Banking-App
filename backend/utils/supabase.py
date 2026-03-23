import json
import random
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Iterable, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, urlencode, urlparse
from urllib.request import Request, urlopen

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

    def _request(
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

        request = Request(url, data=payload, headers=headers, method=method)
        try:
            with urlopen(request) as response:
                raw = response.read().decode("utf-8")
                if not raw:
                    return None
                return json.loads(raw)
        except HTTPError as exc:
            detail = exc.reason
            try:
                payload = json.loads(exc.read().decode("utf-8"))
                detail = payload.get("message") or payload.get("msg") or payload
            except Exception:
                pass
            raise HTTPException(status_code=exc.code, detail=detail) from exc
        except URLError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Unable to reach Supabase: {exc.reason}",
            ) from exc

    def get_authenticated_user(self, access_token: str) -> SupabaseUser:
        payload = self._request("GET", "/auth/v1/user", auth_token=access_token)
        return SupabaseUser(
            id=payload["id"],
            email=payload.get("email") or "",
            user_metadata=payload.get("user_metadata") or {},
            phone=payload.get("phone"),
            created_at=payload.get("created_at") or "",
        )

    def select_rows(
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
        return self._request("GET", f"/rest/v1/{table}", query=query) or []

    def insert_row(self, table: str, values: dict[str, Any]) -> dict[str, Any]:
        rows = self._request(
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

    def update_rows(
        self,
        table: str,
        values: dict[str, Any],
        *,
        filters: dict[str, str],
    ) -> list[dict[str, Any]]:
        query: list[tuple[str, str]] = []
        for key, value in filters.items():
            query.append((key, value))
        rows = self._request(
            "PATCH",
            f"/rest/v1/{table}",
            query=query,
            body=values,
            prefer="return=representation",
        ) or []
        return rows

    def create_signed_upload_url(
        self,
        bucket: str,
        path: str,
        *,
        upsert: bool = False,
    ) -> dict[str, Any]:
        encoded_path = quote(path, safe="/")
        response = self._request(
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


supabase_client = SupabaseClient()
