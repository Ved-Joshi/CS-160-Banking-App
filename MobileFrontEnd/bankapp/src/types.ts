export type AccountType = "Checking" | "Savings" | "Credit";
export type TransactionType = "Deposit" | "Withdrawal" | "Transfer" | "Bill Pay" | "ATM" | "Interest";
export type TransactionStatus = "PENDING" | "COMPLETED" | "FAILED";
export type DepositStatus = "PENDING_REVIEW" | "APPROVED" | "DECLINED";
export type PaymentStatus = "SCHEDULED" | "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELLED";
export type NotificationType = "deposit" | "payment" | "transfer" | "security";
export type TransferScheduleMode = "NOW" | "SCHEDULED";
export type TransferCadence = "Once" | "Daily" | "Weekly" | "Biweekly" | "Monthly";
export type MemberTransferPlanStatus = "SCHEDULED" | "PROCESSING" | "COMPLETED" | "CANCELLED";

export interface User {
  id: string;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
}

export interface RegistrationInput {
  email: string;
  password: string;
  username?: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  mobilePhone?: string;
  streetAddress?: string;
  apartmentUnit?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  dateOfBirth?: string;
  taxId?: string;
}

export interface CustomerProfile {
  id: string;
  fullName: string;
  username: string;
  email: string;
  phone: string;
  address: string;
  streetAddress?: string;
  apartmentUnit?: string | null;
  city?: string;
  state?: string;
  zipCode?: string;
  firstName?: string;
  middleName?: string | null;
  lastName?: string;
  memberSince: string;
  timezone?: string;
  mfaEnabled: boolean;
}

export interface UpdateCustomerProfileInput {
  firstName: string;
  middleName?: string;
  lastName: string;
  phone: string;
  streetAddress: string;
  apartmentUnit?: string;
  city: string;
  state: string;
  zipCode: string;
}

export interface BankAccount {
  id: string;
  nickname: string;
  type: AccountType;
  maskedNumber: string;
  status: "Open" | "Restricted";
  routingNumber: string;
  openedAt: string;
  closeEligible: boolean;
  canClose: boolean;
  closeReasons: string[];
  isDefaultInternalReceive?: boolean;
  balances: {
    availableBalance: number;
    currentBalance: number;
  };
}

export interface Transaction {
  id: string;
  accountId: string;
  description: string;
  amount: number;
  direction: "credit" | "debit";
  status: TransactionStatus;
  type: TransactionType;
  postedAt: string;
}

export interface Payee {
  id: string;
  name: string;
  category: string;
  accountMask: string;
}

export interface ScheduledPayment {
  id: string;
  payeeId: string;
  payeeName: string;
  accountId: string;
  amount: number;
  cadence: TransferCadence;
  deliverBy: string;
  status: PaymentStatus;
  failureReason?: string | null;
}

export interface Deposit {
  id: string;
  accountId: string;
  amount: number;
  submittedAt: string;
  status: DepositStatus;
  note?: string;
  images: {
    front?: { id: string; fileName: string; capturedAt: string };
    back?: { id: string; fileName: string; capturedAt: string };
  };
}

export interface AtmLocation {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  latitude: number;
  longitude: number;
  distanceMiles: number;
  features: string[];
  hours: string;
  openNow?: boolean | null;
  directionsUrl: string;
}

export interface AtmSearchCenter {
  latitude: number;
  longitude: number;
  label: string;
}

export interface AtmSearchResponse {
  center: AtmSearchCenter;
  atms: AtmLocation[];
}

export interface AtmWithdrawalResult {
  id: string;
  status: "COMPLETED" | "FAILED";
  submittedAt: string;
  failureReason?: string | null;
}

export type ExternalAccountType = "Checking" | "Savings";
export type ExternalAccountVerificationStatus = "VERIFIED" | "PENDING" | "FAILED";

export interface ExternalLinkSession {
  clientSecret: string;
  sessionId: string;
  publishableKey: string;
}

export interface ExternalAccount {
  id: string;
  bankName: string;
  nickname: string;
  accountType: ExternalAccountType;
  maskedAccountNumber: string;
  routingNumber: string;
  verificationStatus: ExternalAccountVerificationStatus;
  provider?: string | null;
  providerAccountId?: string | null;
  isActive: boolean;
  createdAt: string;
}

export type ExternalTransferStatus = "PROCESSING" | "COMPLETED" | "FAILED";

export interface ExternalTransfer {
  id: string;
  fromAccountId: string;
  externalAccountId: string;
  externalAccountLabel: string;
  amount: number;
  memo?: string;
  transferDate: string;
  status: ExternalTransferStatus;
  submittedAt: string;
  processedAt?: string | null;
  completedAt?: string | null;
  settleAfter?: string | null;
  failureReason?: string | null;
}

export interface ExternalTransferPlan {
  id: string;
  fromAccountId: string;
  externalAccountId: string;
  externalAccountLabel: string;
  amount: number;
  memo?: string;
  cadence: TransferCadence;
  startDate: string;
  runTime: string;
  timezone: string;
  endDate?: string | null;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  lastFailureReason?: string | null;
  status: MemberTransferPlanStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ExternalTransferSubmissionResult {
  mode: TransferScheduleMode;
  transfer?: ExternalTransfer | null;
  plan?: ExternalTransferPlan | null;
}

export interface NotificationItem {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
}

export interface MemberTransferRecipient {
  userId: string;
  displayName: string;
  email: string;
  defaultCheckingAccountMasked: string;
}

export interface MemberTransfer {
  id: string;
  fromAccountId: string;
  toAccountId: string;
  recipientDisplayName: string;
  amount: number;
  memo?: string;
  transferDate: string;
  status: "PENDING" | "COMPLETED" | "FAILED";
  submittedAt: string;
}

export interface MemberTransferPlan {
  id: string;
  fromAccountId: string;
  recipientUserId: string;
  recipientDisplayName: string;
  amount: number;
  memo?: string;
  cadence: TransferCadence;
  startDate: string;
  runTime: string;
  endDate?: string;
  timezone: string;
  nextRunAt?: string;
  lastFailureReason?: string;
  status: MemberTransferPlanStatus;
  createdAt: string;
  updatedAt: string;
}
