from typing import Literal, Optional

from pydantic import BaseModel, Field


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


class CreateBankAccountIn(BaseModel):
    nickname: str = Field(min_length=2, max_length=80)
    type: AccountType


class CreateScheduledPaymentIn(BaseModel):
    payeeId: str
    accountId: str
    amount: float = Field(gt=0)
    cadence: PaymentCadence
    deliverBy: str


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


class CreateDepositUploadUrlsIn(BaseModel):
    frontFileName: str = Field(min_length=1, max_length=255)
    backFileName: str = Field(min_length=1, max_length=255)


class SignedUploadTarget(BaseModel):
    path: str
    token: str
    signedUrl: str


class DepositUploadUrls(BaseModel):
    bucket: str
    front: SignedUploadTarget
    back: SignedUploadTarget


class CreateDepositIn(BaseModel):
    accountId: str
    amount: float = Field(gt=0)
    frontImagePath: str = Field(min_length=1)
    backImagePath: str = Field(min_length=1)


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
    firstName: str
    middleName: Optional[str] = None
    lastName: str
    fullName: str
    email: str
    phone: str
    address: str
    memberSince: str
    mfaEnabled: bool
