import pytest
from fastapi import HTTPException

from services import transfer_service
from utils.supabase import SupabaseUser


@pytest.mark.asyncio
async def test_resolve_member_recipient_blocks_admin_recipient(monkeypatch: pytest.MonkeyPatch) -> None:
    current_user = SupabaseUser(
        id="user_sender",
        email="sender@example.com",
        user_metadata={},
        app_metadata={"roles": ["member"]},
        phone=None,
        created_at="2026-01-01T00:00:00Z",
    )

    async def _select_rows(table: str, **kwargs):
        if table == "profiles":
            return [{"id": "user_admin", "email": "admin@example.com", "first_name": "Admin", "last_name": "User"}]
        if table == "accounts":
            return [{"account_last4": "0001"}]
        return []

    async def _get_user_admin(user_id: str):
        assert user_id == "user_admin"
        return {"app_metadata": {"roles": ["admin"]}, "user_metadata": {}}

    monkeypatch.setattr(transfer_service.supabase_client, "select_rows", _select_rows)
    monkeypatch.setattr(transfer_service.supabase_client, "get_user_admin", _get_user_admin)

    with pytest.raises(HTTPException) as exc_info:
        await transfer_service.resolve_member_recipient_for_user(current_user, "admin@example.com")

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Transfers to admin accounts are not allowed."
