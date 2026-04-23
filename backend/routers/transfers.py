
#  Used to test transfers before editing into banking read, may delete
from fastapi import APIRouter, Depends, status

from dependencies.auth import get_current_user
from routers.banking_read import parse_transfer_date
from schemas.banking import CreateTransferIn, TransferSubmissionResult
from services.transfer_service import create_transfer_for_user
from utils.supabase import SupabaseUser

router = APIRouter(prefix="/api/transfers", tags=["banking"])


@router.post("", response_model=TransferSubmissionResult, status_code=status.HTTP_201_CREATED)
async def create_transfer(
    data: CreateTransferIn,
    current_user: SupabaseUser = Depends(get_current_user),
):
    return await create_transfer_for_user(
        current_user=current_user,
        payload=data,
        parsed_transfer_date=parse_transfer_date(data.transferDate),
    )
