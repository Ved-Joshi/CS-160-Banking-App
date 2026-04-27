import httpx
import pytest
from fastapi import FastAPI

from utils.rate_limit import GlobalRateLimitMiddleware


@pytest.mark.asyncio
async def test_rate_limit_allows_then_blocks() -> None:
    app = FastAPI()
    app.add_middleware(GlobalRateLimitMiddleware, requests_per_window=2, window_seconds=60)

    @app.get("/ping")
    async def ping() -> dict[str, str]:
        return {"ok": "yes"}

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        first = await client.get("/ping")
        second = await client.get("/ping")
        blocked = await client.get("/ping")

    assert first.status_code == 200
    assert second.status_code == 200
    assert blocked.status_code == 429
    assert blocked.headers.get("retry-after") is not None
    assert blocked.headers.get("x-ratelimit-limit") == "2"
    assert blocked.headers.get("x-ratelimit-remaining") == "0"


@pytest.mark.asyncio
async def test_rate_limit_headers_present_on_success() -> None:
    app = FastAPI()
    app.add_middleware(GlobalRateLimitMiddleware, requests_per_window=3, window_seconds=60)

    @app.get("/ok")
    async def ok() -> dict[str, bool]:
        return {"ok": True}

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.get("/ok")

    assert response.status_code == 200
    assert response.headers.get("x-ratelimit-limit") == "3"
    assert response.headers.get("x-ratelimit-remaining") is not None
    assert response.headers.get("x-ratelimit-reset") is not None
