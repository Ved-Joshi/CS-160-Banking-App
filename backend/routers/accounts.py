from fastapi import APIRouter, Depends, status

from dependencies.auth import get_current_user
from schemas.accounts import (
    AccountBalanceOut,
    AccountCloseOut,
    AccountCreateIn,
    AccountOut,
)
from services.account_service import (
    close_account_for_user,
    create_account_for_user,
    get_account_balances,
    get_account_for_user,
    list_accounts_for_user,
)
from utils.supabase import SupabaseUser

router = APIRouter(prefix="/accounts", tags=["accounts"])


@router.post("", response_model=AccountOut, status_code=status.HTTP_201_CREATED)
async def create_account(
    data: AccountCreateIn,
    current_user: SupabaseUser = Depends(get_current_user),
):
    return await create_account_for_user(
        current_user=current_user,
        account_type=data.account_type,
        nickname=data.nickname,
    )


@router.get("", response_model=list[AccountOut])
async def list_accounts(
    current_user: SupabaseUser = Depends(get_current_user),
):
    return await list_accounts_for_user(current_user)


@router.get("/{account_id}", response_model=AccountOut)
async def get_account(
    account_id: str,
    current_user: SupabaseUser = Depends(get_current_user),
):
    return await get_account_for_user(account_id, current_user)


@router.get("/{account_id}/balance", response_model=AccountBalanceOut)
async def get_account_balance(
    account_id: str,
    current_user: SupabaseUser = Depends(get_current_user),
):
    return await get_account_balances(account_id, current_user)


@router.post("/{account_id}/close", response_model=AccountCloseOut)
async def close_account(
    account_id: str,
    current_user: SupabaseUser = Depends(get_current_user),
):
    return await close_account_for_user(account_id, current_user)