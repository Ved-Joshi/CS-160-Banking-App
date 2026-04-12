
#  Used to test transfers before editing into banking read, may delete
from fastapi import APIRouter, Depends, status

from dependencies.auth import get_current_user
from schemas.banking import CreateTransferIn, TransferResult
from services.transfer_service import create_transfer_for_user
from utils.supabase import SupabaseUser

router = APIRouter(prefix="/api/transfers", tags=["banking"])


@router.post("", response_model=TransferResult, status_code=status.HTTP_201_CREATED)
async def create_transfer(
    data: CreateTransferIn,
    current_user: SupabaseUser = Depends(get_current_user),
):
    return await create_transfer_for_user(
        current_user=current_user,
        from_account_id=data.fromAccountId,
        to_account_id=data.toAccountId,
        amount=data.amount,
        memo=data.memo,
        transfer_date=data.transferDate,
    )