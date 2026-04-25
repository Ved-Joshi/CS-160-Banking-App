from typing import Literal, Optional

from pydantic import BaseModel, Field


AccountType = Literal["Checking", "Savings", "Credit"]
TransactionType = Literal["Deposit", "Withdrawal", "Transfer", "Bill Pay", "ATM", "Interest"]
TransactionStatus = Literal["PENDING", "COMPLETED", "FAILED"]
DepositStatus = Literal["PENDING_REVIEW", "APPROVED", "DECLINED"]
DepositType = Literal["cash", "check"]
PaymentStatus = Literal["SCHEDULED", "PROCESSING", "COMPLETED", "FAILED", "CANCELLED"]
NotificationType = Literal["deposit", "payment", "transfer", "security"]
PaymentCadence = Literal["Once", "Daily", "Weekly", "Biweekly", "Monthly"]
TransferStatus = Literal["PENDING", "COMPLETED", "FAILED"]


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
    closeEligible: bool = Field(description="Deprecated compatibility field that mirrors whether the account can be closed right now.")
    canClose: bool = Field(description="Whether the account can be closed immediately based on balances, status, and pending activity.")
    closeReasons: list[str] = Field(description="User-facing reasons that currently block account closure.")
    balances: BalanceSummary


class CreateBankAccountIn(BaseModel):
    nickname: str = Field(min_length=2, max_length=80)
    type: AccountType


class CreateScheduledPaymentIn(BaseModel):
    payeeId: str
    accountId: str
    amount: float = Field(gt=0, le=100000)
    cadence: PaymentCadence
    deliverBy: str


class UpdateScheduledPaymentIn(BaseModel):
    payeeId: Optional[str] = None
    amount: Optional[float] = Field(default=None, gt=0, le=100000)
    cadence: Optional[PaymentCadence] = None
    deliverBy: Optional[str] = None


class Transaction(BaseModel):
    id: str
    accountId: str
    description: str
    amount: float
    direction: Literal["credit", "debit"]
    status: TransactionStatus
    type: TransactionType
    postedAt: str


class CreateTransferIn(BaseModel):
    fromAccountId: str
    toAccountId: str
    amount: float = Field(gt=0)
    memo: Optional[str] = Field(default=None, max_length=80)
    transferDate: str


class TransferResult(BaseModel):
    id: str
    status: TransferStatus
    submittedAt: str


class Payee(BaseModel):
    id: str
    name: str
    category: str
    accountMask: str


class CreatePayeeIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    category: str = Field(default="Other", min_length=1, max_length=50)
    accountLast4: Optional[str] = Field(default=None, min_length=4, max_length=4, pattern=r"^\d{4}$")


class ScheduledPayment(BaseModel):
    id: str
    payeeId: str
    payeeName: str
    accountId: str
    amount: float
    cadence: PaymentCadence
    deliverBy: str
    status: PaymentStatus
    failureReason: Optional[str] = None


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
    depositType: DepositType
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
    depositType: DepositType = "check"


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
    latitude: float
    longitude: float
    distanceMiles: float
    features: list[str]
    hours: str
    openNow: Optional[bool] = None
    directionsUrl: str


class AtmSearchCenter(BaseModel):
    latitude: float
    longitude: float
    label: str


class AtmSearchResponse(BaseModel):
    center: AtmSearchCenter
    atms: list[AtmLocation]


class CustomerProfile(BaseModel):
    id: str
    firstName: str
    middleName: Optional[str] = None
    lastName: str
    fullName: str
    email: str
    phone: str
    address: str
    streetAddress: str
    apartmentUnit: Optional[str] = None
    city: str
    state: str
    zipCode: str
    memberSince: str
    timezone: str


class UpdateCustomerProfileIn(BaseModel):
    firstName: str = Field(min_length=1, max_length=80)
    middleName: Optional[str] = Field(default=None, max_length=80)
    lastName: str = Field(min_length=1, max_length=80)
    phone: str = Field(min_length=10, max_length=20)
    streetAddress: str = Field(min_length=1, max_length=160)
    apartmentUnit: Optional[str] = Field(default=None, max_length=30)
    city: str = Field(min_length=1, max_length=80)
    state: str = Field(min_length=2, max_length=2)
    zipCode: str = Field(min_length=5, max_length=10)
