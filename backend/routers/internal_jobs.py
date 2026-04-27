from fastapi import APIRouter, Header, HTTPException, status

from config import settings
from services.deposit_service import cleanup_expired_deposit_uploads, process_due_check_deposits
from services.payment_service import process_due_bill_payments
from services.transfer_service import (
    process_due_external_transfers,
    process_due_member_transfer_plans,
    process_due_transfer_plans,
)


router = APIRouter(prefix="/internal/jobs", tags=["internal-jobs"])


def _authorize_runner(secret: str | None) -> None:
    configured = settings.TRANSFER_RUNNER_SECRET
    if not configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Runner secret is not configured.",
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


@router.post("/process-bill-payments")
async def run_due_bill_payments(
    x_runner_secret: str | None = Header(default=None),
    limit: int = 50,
) -> dict[str, int]:
    _authorize_runner(x_runner_secret)
    bounded_limit = max(1, min(limit, 250))
    return await process_due_bill_payments(batch_size=bounded_limit)


@router.post("/process-member-transfer-plans")
async def run_due_member_transfer_plans(
    x_runner_secret: str | None = Header(default=None),
    limit: int = 50,
) -> dict[str, int]:
    _authorize_runner(x_runner_secret)
    bounded_limit = max(1, min(limit, 250))
    return await process_due_member_transfer_plans(batch_size=bounded_limit)


@router.post("/process-external-transfers")
async def run_due_external_transfers(
    x_runner_secret: str | None = Header(default=None),
    limit: int = 50,
) -> dict[str, int]:
    _authorize_runner(x_runner_secret)
    bounded_limit = max(1, min(limit, 250))
    return await process_due_external_transfers(batch_size=bounded_limit)


@router.post("/process-pending-check-deposits")
async def run_due_check_deposits(
    x_runner_secret: str | None = Header(default=None),
    limit: int = 50,
) -> dict[str, int]:
    _authorize_runner(x_runner_secret)
    bounded_limit = max(1, min(limit, 250))
    return await process_due_check_deposits(batch_size=bounded_limit)


@router.post("/cleanup-orphaned-deposit-uploads")
async def run_orphaned_deposit_upload_cleanup(
    x_runner_secret: str | None = Header(default=None),
    limit: int = 100,
) -> dict[str, int]:
    _authorize_runner(x_runner_secret)
    bounded_limit = max(1, min(limit, 500))
    return await cleanup_expired_deposit_uploads(batch_size=bounded_limit)
