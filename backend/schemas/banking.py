from typing import Literal, Optional

from pydantic import BaseModel


AccountType = Literal["Checking", "Savings", "Credit"]
TransactionType = Literal["Deposit", "Withdrawal", "Transfer", "Bill Pay", "ATM", "Interest"]
TransactionStatus = Literal["PENDING", "COMPLETED", "FAILED"]


class BalanceSummary(BaseModel):
    availableBalance: float
    currentBalance: float


class BankAccount(BaseModel):
    id: str
    nickname: str
    type: AccountType
    maskedNumber: str
    status: Literal["Open", "Restricted"]
    routingNumber: str
    openedAt: str
    closeEligible: bool
    balances: BalanceSummary


class Transaction(BaseModel):
    id: str
    accountId: str
    description: str
    amount: float
    direction: Literal["credit", "debit"]
    status: TransactionStatus
    type: TransactionType
    postedAt: str


class CustomerProfile(BaseModel):
    id: str
    fullName: str
    username: Optional[str] = None
    email: str
    phone: str
    address: str
    memberSince: str
    mfaEnabled: bool
