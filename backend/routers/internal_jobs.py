from fastapi import APIRouter, Header, HTTPException, status

from config import settings
from services.transfer_service import process_due_transfer_plans


router = APIRouter(prefix="/internal/jobs", tags=["internal-jobs"])


def _authorize_runner(secret: str | None) -> None:
    configured = settings.TRANSFER_RUNNER_SECRET
    if not configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Transfer runner secret is not configured.",
        )
    if not secret or secret != configured:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid runner secret.",
        )


@router.post("/process-transfer-plans")
async def run_due_transfer_plans(
    x_runner_secret: str | None = Header(default=None),
    limit: int = 50,
) -> dict[str, int]:
    _authorize_runner(x_runner_secret)
    bounded_limit = max(1, min(limit, 250))
    return await process_due_transfer_plans(batch_size=bounded_limit)
