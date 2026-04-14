from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


AccountType = Literal["checking", "savings", "credit"]
AccountStatus = Literal["open", "frozen", "closed"]


class AccountCreateIn(BaseModel):
    account_type: AccountType
    nickname: Optional[str] = Field(default=None, max_length=100)


class AccountOut(BaseModel):
    id: str
    user_id: str
    nickname: Optional[str] = None
    account_type: AccountType
    account_last4: Optional[str] = None
    routing_number: Optional[str] = None
    status: AccountStatus
    available_balance_cents: int
    current_balance_cents: int
    opened_at: datetime
    close_eligible: bool
    created_at: datetime
    updated_at: datetime


class AccountBalanceOut(BaseModel):
    account_id: str
    available_balance_cents: int
    current_balance_cents: int


class AccountCloseOut(BaseModel):
    message: str
    account_id: str
    status: AccountStatus