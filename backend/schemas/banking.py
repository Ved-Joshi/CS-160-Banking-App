from typing import Literal, Optional

from pydantic import BaseModel


AccountType = Literal["Checking", "Savings", "Credit"]
TransactionType = Literal["Deposit", "Withdrawal", "Transfer", "Bill Pay", "ATM", "Interest"]
TransactionStatus = Literal["PENDING", "COMPLETED", "FAILED"]
DepositStatus = Literal["PENDING_REVIEW", "APPROVED", "DECLINED"]
PaymentStatus = Literal["SCHEDULED", "PROCESSING", "COMPLETED", "FAILED", "CANCELLED"]
NotificationType = Literal["deposit", "payment", "transfer", "security"]
PaymentCadence = Literal["Once", "Weekly", "Biweekly", "Monthly"]


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


class Payee(BaseModel):
    id: str
    name: str
    category: str
    accountMask: str


class ScheduledPayment(BaseModel):
    id: str
    payeeId: str
    payeeName: str
    accountId: str
    amount: float
    cadence: PaymentCadence
    deliverBy: str
    status: PaymentStatus


class DepositImage(BaseModel):
    id: str
    fileName: str
    capturedAt: str


class DepositImages(BaseModel):
    front: Optional[DepositImage] = None
    back: Optional[DepositImage] = None


class Deposit(BaseModel):
    id: str
    accountId: str
    amount: float
    submittedAt: str
    status: DepositStatus
    note: Optional[str] = None
    images: DepositImages


class NotificationItem(BaseModel):
    id: str
    type: NotificationType
    title: str
    body: str
    createdAt: str
    read: bool


class AtmLocation(BaseModel):
    id: str
    name: str
    address: str
    city: str
    state: str
    zip: str
    distanceMiles: float
    features: list[str]
    hours: str


class CustomerProfile(BaseModel):
    id: str
    fullName: str
    username: Optional[str] = None
    email: str
    phone: str
    address: str
    memberSince: str
    mfaEnabled: bool
