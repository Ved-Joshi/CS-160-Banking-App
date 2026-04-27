from datetime import datetime, timezone

from fastapi import HTTPException

from utils.supabase import supabase_client


async def process_due_check_deposits(batch_size: int = 50) -> dict[str, int]:
    bounded = max(1, min(batch_size, 250))
    result = await supabase_client.rpc("process_due_check_deposits", {"p_limit": bounded})
    row = result[0] if isinstance(result, list) and result else (result or {})
    return {
        "processed": int(row.get("processed_count") or 0),
        "failed": int(row.get("failed_count") or 0),
    }


async def cleanup_expired_deposit_uploads(batch_size: int = 100) -> dict[str, int]:
    bounded = max(1, min(batch_size, 500))
    now_iso = datetime.now(timezone.utc).isoformat()
    rows = await supabase_client.select_rows(
        "deposit_upload_sessions",
        filters={
            "status": "eq.reserved",
            "expires_at": f"lte.{now_iso}",
        },
        order="created_at.asc",
        limit=bounded,
    )

    cleaned = 0
    failed = 0
    for row in rows:
        session_id = row.get("id")
        front_path = row.get("front_image_path")
        back_path = row.get("back_image_path")
        if not session_id or not front_path or not back_path:
            failed += 1
            continue
        try:
            try:
                await supabase_client.delete_storage_object("deposit-check-images", str(front_path))
            except HTTPException as exc:
                if exc.status_code != 404:
                    raise
            try:
                await supabase_client.delete_storage_object("deposit-check-images", str(back_path))
            except HTTPException as exc:
                if exc.status_code != 404:
                    raise
            await supabase_client.update_rows(
                "deposit_upload_sessions",
                {
                    "status": "cleaned",
                    "cleaned_at": now_iso,
                },
                filters={
                    "id": f"eq.{session_id}",
                    "status": "eq.reserved",
                },
            )
            cleaned += 1
        except HTTPException:
            failed += 1

    return {
        "cleaned": cleaned,
        "failed": failed,
    }
