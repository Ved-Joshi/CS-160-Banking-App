from fastapi import APIRouter, Depends

from dependencies.auth import get_current_user
from utils.supabase import supabase_client

router = APIRouter(prefix="/api/me", tags=["me"])


@router.get("/admin")
async def me_admin(current_user=Depends(get_current_user)) -> dict[str, object]:
    user_admin = await supabase_client.get_user_admin(current_user.id)
    app_meta = user_admin.get("app_metadata") or {}
    user_meta = user_admin.get("user_metadata") or {}
    roles = app_meta.get("roles") or user_meta.get("roles") or []
    if not isinstance(roles, list):
        roles = []
    is_admin = "admin" in roles
    return {"isAdmin": is_admin, "roles": roles}
