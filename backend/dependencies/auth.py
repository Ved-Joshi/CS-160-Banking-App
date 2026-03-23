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

    return supabase_client.get_authenticated_user(access_token)
