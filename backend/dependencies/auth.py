from fastapi import Header, HTTPException, status

from utils.supabase import SupabaseUser, supabase_client


async def get_current_user(authorization: str | None = Header(default=None)) -> SupabaseUser:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token.",
        )

    access_token = authorization.removeprefix("Bearer ").strip()
    if not access_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token.",
        )

    return await supabase_client.get_authenticated_user(access_token)


async def require_admin(current_user: SupabaseUser = Depends(get_current_user)) -> SupabaseUser:
    roles = current_user.app_metadata.get("roles") or current_user.user_metadata.get("roles") or []
    if not isinstance(roles, list):
        roles = []
    if "admin" not in roles:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only.")
    return current_user
