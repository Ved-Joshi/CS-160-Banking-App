
#  Used to test transaction before implementing into banking read, may delete
from fastapi import APIRouter, Depends

from dependencies.auth import get_current_user
from schemas.banking import Transaction
from services.transaction_service import list_transactions_for_user
from utils.supabase import SupabaseUser

router = APIRouter(prefix="/api/transactions", tags=["banking"])


@router.get("", response_model=list[Transaction])
async def list_transactions(
    current_user: SupabaseUser = Depends(get_current_user),
):
    return await list_transactions_for_user(current_user)