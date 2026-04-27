from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime, timezone
from time import monotonic
from typing import Deque

from fastapi import Request, status
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware


@dataclass
class _BucketState:
    window_started_monotonic: float
    request_timestamps: Deque[float]


class SlidingWindowRateLimiter:
    """In-memory sliding-window rate limiter keyed by client identity."""

    def __init__(self, *, requests_per_window: int, window_seconds: int) -> None:
        self.requests_per_window = max(1, requests_per_window)
        self.window_seconds = max(1, window_seconds)
        self._buckets: dict[str, _BucketState] = defaultdict(
            lambda: _BucketState(window_started_monotonic=monotonic(), request_timestamps=deque())
        )

    def check(self, key: str) -> tuple[bool, int, int]:
        now = monotonic()
        bucket = self._buckets[key]
        cutoff = now - self.window_seconds

        while bucket.request_timestamps and bucket.request_timestamps[0] <= cutoff:
            bucket.request_timestamps.popleft()

        if len(bucket.request_timestamps) >= self.requests_per_window:
            oldest = bucket.request_timestamps[0]
            retry_after = max(1, int(self.window_seconds - (now - oldest)))
            return False, 0, retry_after

        bucket.request_timestamps.append(now)
        remaining = max(0, self.requests_per_window - len(bucket.request_timestamps))
        return True, remaining, 0


class GlobalRateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, *, requests_per_window: int, window_seconds: int) -> None:
        super().__init__(app)
        self.limiter = SlidingWindowRateLimiter(
            requests_per_window=requests_per_window,
            window_seconds=window_seconds,
        )
        self.limit = max(1, requests_per_window)
        self.window_seconds = max(1, window_seconds)

    async def dispatch(self, request: Request, call_next):
        key = self._identity_for_request(request)
        allowed, remaining, retry_after = self.limiter.check(key)
        reset_unix = int(datetime.now(timezone.utc).timestamp()) + (retry_after if retry_after else self.window_seconds)

        if not allowed:
            return JSONResponse(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                content={"detail": "Rate limit exceeded. Please retry later."},
                headers={
                    "Retry-After": str(retry_after),
                    "X-RateLimit-Limit": str(self.limit),
                    "X-RateLimit-Remaining": "0",
                    "X-RateLimit-Reset": str(reset_unix),
                },
            )

        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(self.limit)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        response.headers["X-RateLimit-Reset"] = str(reset_unix)
        return response

    @staticmethod
    def _identity_for_request(request: Request) -> str:
        forwarded_for = request.headers.get("x-forwarded-for", "").strip()
        if forwarded_for:
            # Use the left-most IP in RFC 7239 compatible forwarding chains.
            return forwarded_for.split(",")[0].strip()
        client_host = request.client.host if request.client else "unknown"
        return client_host
