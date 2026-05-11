export type AccountType = 'Checking' | 'Savings' | 'Credit';
export type TransactionType =
  | 'Deposit'
  | 'Withdrawal'
  | 'Transfer'
  | 'Bill Pay'
  | 'ATM'
  | 'Interest';
export type TransactionStatus = 'PENDING' | 'COMPLETED' | 'FAILED';
export type DepositStatus = 'PENDING_REVIEW' | 'APPROVED' | 'DECLINED';
export type DepositType = 'atm' | 'check';
export type PaymentStatus = 'SCHEDULED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type TransferStatus = 'PENDING' | 'COMPLETED' | 'FAILED';
export type TransferScheduleMode = 'NOW' | 'SCHEDULED';
export type TransferCadence = 'Once' | 'Daily' | 'Weekly' | 'Biweekly' | 'Monthly';
export type TransferPlanStatus = 'SCHEDULED' | 'PROCESSING' | 'COMPLETED' | 'CANCELLED';
export type ExternalTransferStatus = 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type NotificationType = 'deposit' | 'payment' | 'transfer' | 'security';

export interface User {
  id: string;
  email: string;
  username?: string;
  firstName: string;
  middleName?: string | null;
  lastName: string;
  roles?: string[];
}

export interface CustomerProfile {
  id: string;
  firstName: string;
  middleName?: string | null;
  lastName: string;
  fullName: string;
  email: string;
  phone: string;
  address: string;
  streetAddress: string;
  apartmentUnit?: string | null;
  city: string;
  state: string;
  zipCode: string;
  memberSince: string;
  timezone: string;
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

export interface RegistrationInput {
  firstName: string;
  middleName?: string;
  lastName: string;
  email: string;
  mobilePhone: string;
  streetAddress: string;
  apartmentUnit?: string;
  city: string;
  state: string;
  zipCode: string;
  dateOfBirth: string;
  password: string;
  passwordConfirmation: string;
}

export interface BalanceSummary {
  availableBalance: number;
  currentBalance: number;
}

/**
 * Customer account shape returned by the banking API.
 * `closeEligible` is kept for backward compatibility and mirrors `canClose`.
 */
export interface BankAccount {
  id: string;
  nickname: string;
  type: AccountType;
  maskedNumber: string;
  status: 'Open' | 'Restricted';
  routingNumber?: string | null;
  openedAt: string;
  /** Deprecated. Use `canClose` instead. */
  closeEligible: boolean;
  /** True only when the account can be closed immediately. */
  canClose: boolean;
  /** User-facing reasons that currently block account closure. */
  closeReasons: string[];
  balances: BalanceSummary;
  isDefaultInternalReceive?: boolean;
}

export interface CreateBankAccountInput {
  nickname: string;
  type: AccountType;
}

export interface AdminAccountReportRow {
  accountId: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  zipCode: string;
  city: string;
  state: string;
  accountNickname: string;
  accountType: AccountType;
  accountStatus: 'Open' | 'Restricted';
  openedAt: string;
  currentBalance: number;
  availableBalance: number;
  maskedNumber: string;
}

export interface AdminAccountReportSummary {
  totalAccounts: number;
  distinctCustomers: number;
  openAccounts: number;
  restrictedAccounts: number;
  totalCurrentBalance: number;
  averageCurrentBalance: number;
}

export interface AdminAccountReportResponse {
  rows: AdminAccountReportRow[];
  summary: AdminAccountReportSummary;
}

export interface Transaction {
  id: string;
  accountId: string;
  description: string;
  amount: number;
  direction: 'credit' | 'debit';
  status: TransactionStatus;
  type: TransactionType;
  postedAt: string;
}

export interface TransferRequest {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  memo?: string;
  transferDate: string;
}

export interface TransferResult {
  id: string;
  status: TransferStatus;
  submittedAt: string;
}

export interface TransferPlan {
  id: string;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  memo?: string;
  cadence: TransferCadence;
  startDate: string;
  runTime: string;
  timezone: string;
  endDate?: string;
  nextRunAt?: string;
  lastRunAt?: string;
  lastFailureReason?: string;
  status: TransferPlanStatus;
  createdAt: string;
  updatedAt: string;
}

export interface TransferSubmissionResult {
  mode: TransferScheduleMode;
  transfer?: TransferResult;
  plan?: TransferPlan;
}

export interface MemberTransferRecipient {
  userId: string;
  displayName: string;
  email: string;
  defaultCheckingAccountMasked: string;
}

export interface MemberTransferRequest {
  fromAccountId: string;
  recipientEmail: string;
  amount: number;
  memo?: string;
  scheduleMode: TransferScheduleMode;
  transferDate?: string;
  cadence?: TransferCadence;
  startDate?: string;
  runTime?: string;
  endDate?: string;
  timezone?: string;
}

export interface MemberTransfer {
  id: string;
  fromAccountId: string;
  recipientUserId: string;
  recipientDisplayName: string;
  amount: number;
  memo?: string;
  transferDate: string;
  status: TransferStatus;
  submittedAt: string;
  completedAt?: string;
  failureReason?: string;
}

export interface MemberTransferPlan {
  id: string;
  fromAccountId: string;
  recipientUserId: string;
  recipientEmail: string;
  recipientDisplayName: string;
  amount: number;
  memo?: string;
  cadence: TransferCadence;
  startDate: string;
  runTime: string;
  timezone: string;
  endDate?: string;
  nextRunAt?: string;
  lastRunAt?: string;
  lastFailureReason?: string;
  status: TransferPlanStatus;
  createdAt: string;
  updatedAt: string;
}

export interface MemberTransferSubmissionResult {
  mode: TransferScheduleMode;
  transfer?: MemberTransfer;
  plan?: MemberTransferPlan;
}

export interface UpdateMemberTransferPlanInput {
  amount?: number;
  memo?: string;
  cadence?: TransferCadence;
  startDate?: string;
  runTime?: string;
  endDate?: string;
  timezone?: string;
}

export interface ExternalAccount {
  id: string;
  bankName: string;
  nickname: string;
  accountType: 'Checking' | 'Savings';
  maskedAccountNumber: string;
  routingNumber: string;
  verificationStatus: 'PENDING' | 'VERIFIED' | 'FAILED';
  provider?: string;
  providerAccountId?: string;
  isActive: boolean;
  createdAt: string;
}

export interface CreateExternalAccountInput {
  bankName: string;
  nickname: string;
  accountType: 'Checking' | 'Savings';
  routingNumber: string;
  accountNumber: string;
  confirmAccountNumber: string;
}

export interface ExternalLinkSession {
  clientSecret: string;
  sessionId: string;
  publishableKey: string;
}

export interface CompleteExternalLinkInput {
  accountId: string;
}

export interface ExternalTransferRequest {
  fromAccountId: string;
  externalAccountId: string;
  amount: number;
  memo?: string;
  scheduleMode: TransferScheduleMode;
  transferDate?: string;
  cadence?: TransferCadence;
  startDate?: string;
  runTime?: string;
  endDate?: string;
  timezone?: string;
}

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
  processedAt?: string;
  completedAt?: string;
  settleAfter?: string;
  failureReason?: string;
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
  endDate?: string;
  nextRunAt?: string;
  lastRunAt?: string;
  lastFailureReason?: string;
  status: TransferPlanStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ExternalTransferSubmissionResult {
  mode: TransferScheduleMode;
  transfer?: ExternalTransfer;
  plan?: ExternalTransferPlan;
}

export interface UpdateExternalTransferPlanInput {
  amount?: number;
  memo?: string;
  cadence?: TransferCadence;
  startDate?: string;
  runTime?: string;
  endDate?: string;
  timezone?: string;
}

export interface Payee {
  id: string;
  name: string;
  category: string;
  accountMask: string;
}

export interface CreatePayeeInput {
  name: string;
  category: string;
  routingNumber: string;
  accountNumber: string;
  confirmAccountNumber: string;
}

export interface ScheduledPayment {
  id: string;
  payeeId: string;
  payeeName: string;
  accountId: string;
  amount: number;
  cadence: 'Once' | 'Daily' | 'Weekly' | 'Biweekly' | 'Monthly';
  deliverBy: string;
  endDate?: string;
  status: PaymentStatus;
  failureReason?: string;
}

export interface CreateScheduledPaymentInput {
  payeeId: string;
  accountId: string;
  amount: number;
  cadence: 'Once' | 'Daily' | 'Weekly' | 'Biweekly' | 'Monthly';
  deliverBy: string;
}

export interface UpdateScheduledPaymentInput {
  payeeId?: string;
  amount?: number;
  cadence?: 'Once' | 'Daily' | 'Weekly' | 'Biweekly' | 'Monthly';
  deliverBy?: string;
}

export interface DepositImage {
  id: string;
  fileName: string;
  capturedAt: string;
}

export interface Deposit {
  id: string;
  accountId: string;
  amount: number;
  depositType: DepositType;
  submittedAt: string;
  status: DepositStatus;
  note?: string;
  images: {
    front?: DepositImage;
    back?: DepositImage;
  };
}

export interface DepositUploadTarget {
  path: string;
  token: string;
  signedUrl: string;
}

export interface DepositUploadUrls {
  bucket: string;
  front: DepositUploadTarget;
  back: DepositUploadTarget;
}

export interface CreateDepositUploadUrlsInput {
  frontFileName: string;
  backFileName: string;
  frontContentType: string;
  backContentType: string;
  frontFileSizeBytes: number;
  backFileSizeBytes: number;
}

export interface CreateDepositInput {
  accountId: string;
  amount: number;
  depositMethod: DepositType;
  depositType?: 'cash' | 'check';
  frontImagePath?: string;
  backImagePath?: string;
}

export interface CreateAtmWithdrawalInput {
  accountId: string;
  amount: number;
}

export interface AtmWithdrawalResult {
  id: string;
  status: 'COMPLETED' | 'FAILED';
  submittedAt: string;
  failureReason?: string;
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
  openNow: boolean | null;
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

export interface AtmSearchInput {
  lat?: number;
  lng?: number;
  query?: string;
  radiusMiles?: number;
  openNow?: boolean;
  limit?: number;
}

export interface NotificationItem {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
}
