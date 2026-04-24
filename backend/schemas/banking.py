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
TransferScheduleMode = Literal["NOW", "SCHEDULED"]
TransferCadence = Literal["Once", "Daily", "Weekly", "Biweekly", "Monthly"]
MemberTransferPlanStatus = Literal["SCHEDULED", "PROCESSING", "COMPLETED", "CANCELLED"]
ExternalTransferStatus = Literal["PROCESSING", "COMPLETED", "FAILED", "CANCELLED"]
ExternalAccountType = Literal["Checking", "Savings"]
ExternalAccountVerificationStatus = Literal["PENDING", "VERIFIED", "FAILED"]


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
    isDefaultInternalReceive: bool = False


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
    routingNumber: str = Field(min_length=9, max_length=9, pattern=r"^\d{9}$")
    accountNumber: str = Field(min_length=4, max_length=17, pattern=r"^\d{4,17}$")
    confirmAccountNumber: str = Field(min_length=4, max_length=17, pattern=r"^\d{4,17}$")


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
    depositType: DepositType


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
    timezone: str = "UTC"


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


class MemberTransferRecipient(BaseModel):
    userId: str
    displayName: str
    email: str
    defaultCheckingAccountMasked: str


class CreateMemberTransferIn(BaseModel):
    fromAccountId: str
    recipientEmail: str = Field(min_length=3, max_length=120)
    amount: float = Field(gt=0)
    memo: Optional[str] = Field(default=None, max_length=80)
    scheduleMode: TransferScheduleMode = "NOW"
    transferDate: Optional[str] = None
    cadence: Optional[TransferCadence] = None
    startDate: Optional[str] = None
    runTime: Optional[str] = None
    endDate: Optional[str] = None
    timezone: Optional[str] = None


class UpdateMemberTransferPlanIn(BaseModel):
    amount: Optional[float] = Field(default=None, gt=0)
    memo: Optional[str] = Field(default=None, max_length=80)
    cadence: Optional[TransferCadence] = None
    startDate: Optional[str] = None
    runTime: Optional[str] = None
    endDate: Optional[str] = None
    timezone: Optional[str] = None


class MemberTransfer(BaseModel):
    id: str
    fromAccountId: str
    recipientUserId: str
    recipientDisplayName: str
    amount: float
    memo: Optional[str] = None
    transferDate: str
    status: TransferStatus
    submittedAt: str
    completedAt: Optional[str] = None
    failureReason: Optional[str] = None


class MemberTransferPlan(BaseModel):
    id: str
    fromAccountId: str
    recipientUserId: str
    recipientEmail: str
    recipientDisplayName: str
    amount: float
    memo: Optional[str] = None
    cadence: TransferCadence
    startDate: str
    runTime: str
    timezone: str
    endDate: Optional[str] = None
    nextRunAt: Optional[str] = None
    lastRunAt: Optional[str] = None
    lastFailureReason: Optional[str] = None
    status: MemberTransferPlanStatus
    createdAt: str
    updatedAt: str


class MemberTransferSubmissionResult(BaseModel):
    mode: TransferScheduleMode
    transfer: Optional[MemberTransfer] = None
    plan: Optional[MemberTransferPlan] = None


class CreateExternalAccountIn(BaseModel):
    bankName: str = Field(min_length=2, max_length=80)
    nickname: str = Field(min_length=2, max_length=80)
    accountType: ExternalAccountType
    routingNumber: str = Field(min_length=9, max_length=9)
    accountNumber: str = Field(min_length=4, max_length=17)
    confirmAccountNumber: str = Field(min_length=4, max_length=17)


class CreateExternalLinkSessionOut(BaseModel):
    clientSecret: str
    sessionId: str
    publishableKey: str


class CompleteExternalLinkIn(BaseModel):
    accountId: str = Field(min_length=1, max_length=100)


class ExternalAccount(BaseModel):
    id: str
    bankName: str
    nickname: str
    accountType: ExternalAccountType
    maskedAccountNumber: str
    routingNumber: str
    verificationStatus: ExternalAccountVerificationStatus
    provider: Optional[str] = None
    providerAccountId: Optional[str] = None
    isActive: bool
    createdAt: str


class CreateExternalTransferIn(BaseModel):
    fromAccountId: str
    externalAccountId: str
    amount: float = Field(gt=0)
    memo: Optional[str] = Field(default=None, max_length=80)
    scheduleMode: TransferScheduleMode = "NOW"
    transferDate: Optional[str] = None
    cadence: Optional[TransferCadence] = None
    startDate: Optional[str] = None
    runTime: Optional[str] = None
    endDate: Optional[str] = None
    timezone: Optional[str] = None


class UpdateExternalTransferPlanIn(BaseModel):
    amount: Optional[float] = Field(default=None, gt=0)
    memo: Optional[str] = Field(default=None, max_length=80)
    cadence: Optional[TransferCadence] = None
    startDate: Optional[str] = None
    runTime: Optional[str] = None
    endDate: Optional[str] = None
    timezone: Optional[str] = None


class ExternalTransfer(BaseModel):
    id: str
    fromAccountId: str
    externalAccountId: str
    externalAccountLabel: str
    amount: float
    memo: Optional[str] = None
    transferDate: str
    status: ExternalTransferStatus
    submittedAt: str
    processedAt: Optional[str] = None
    completedAt: Optional[str] = None
    settleAfter: Optional[str] = None
    failureReason: Optional[str] = None


class ExternalTransferPlan(BaseModel):
    id: str
    fromAccountId: str
    externalAccountId: str
    externalAccountLabel: str
    amount: float
    memo: Optional[str] = None
    cadence: TransferCadence
    startDate: str
    runTime: str
    timezone: str
    endDate: Optional[str] = None
    nextRunAt: Optional[str] = None
    lastRunAt: Optional[str] = None
    lastFailureReason: Optional[str] = None
    status: MemberTransferPlanStatus
    createdAt: str
    updatedAt: str


class ExternalTransferSubmissionResult(BaseModel):
    mode: TransferScheduleMode
    transfer: Optional[ExternalTransfer] = None
    plan: Optional[ExternalTransferPlan] = None
