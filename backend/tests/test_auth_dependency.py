import pytest
from fastapi import HTTPException

from dependencies.auth import get_current_user


@pytest.mark.asyncio
async def test_get_current_user_rejects_missing_header() -> None:
    with pytest.raises(HTTPException) as exc:
        await get_current_user(None)
    assert exc.value.status_code == 401
    assert "Missing bearer token" in str(exc.value.detail)


@pytest.mark.asyncio
async def test_get_current_user_rejects_non_bearer_header() -> None:
    with pytest.raises(HTTPException) as exc:
        await get_current_user("Basic abc123")
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_get_current_user_rejects_empty_bearer_token() -> None:
    with pytest.raises(HTTPException) as exc:
        await get_current_user("Bearer   ")
    assert exc.value.status_code == 401
