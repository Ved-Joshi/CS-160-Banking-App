import type {
  BankAccount,
  ExternalAccount,
  ExternalTransfer,
  ExternalTransferPlan,
  ExternalTransferSubmissionResult,
  MemberTransfer,
  MemberTransferPlan,
  MemberTransferRecipient,
  MemberTransferSubmissionResult,
  ScheduledPayment,
  Transaction,
  TransferPlan,
  TransferResult,
  TransferSubmissionResult,
} from '../types/banking';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' ? (value as UnknownRecord) : {};
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function centsToDollars(value: unknown): number {
  return asNumber(value, 0) / 100;
}

function toTitleCase(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function normalizeAccountType(value: unknown): BankAccount['type'] {
  const normalized = asString(value).toLowerCase();
  if (normalized === 'savings') return 'Savings';
  if (normalized === 'credit') return 'Credit';
  return 'Checking';
}

function normalizeAccountStatus(value: unknown): BankAccount['status'] {
  const normalized = asString(value).toLowerCase();
  if (normalized === 'open') return 'Open';
  if (normalized === 'restricted' || normalized === 'frozen' || normalized === 'closed') return 'Restricted';
  return 'Open';
}

function normalizeMaskedAccount(value: unknown): string {
  const direct = asString(value);
  if (direct) return direct;
  const digits = asString(value).replace(/\D/g, '');
  if (digits.length >= 4) return `•••• ${digits.slice(-4)}`;
  return '••••';
}

function normalizeCloseReasons(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

export function normalizeAccount(input: unknown): BankAccount {
  const row = asRecord(input);
  const balances = asRecord(row.balances);
  const accountLast4 = asString(row.account_last4);
  const maskedNumber = asString(row.maskedNumber) || (accountLast4 ? `•••• ${accountLast4}` : '');
  const availableBalance = balances.availableBalance ?? centsToDollars(row.available_balance_cents);
  const currentBalance = balances.currentBalance ?? centsToDollars(row.current_balance_cents);
  const closeReasons = normalizeCloseReasons(row.closeReasons);
  const closeEligible = asBoolean(row.closeEligible, asBoolean(row.close_eligible, false));
  const canClose = asBoolean(row.canClose, closeEligible && closeReasons.length === 0);

  return {
    id: asString(row.id),
    nickname: asString(row.nickname, 'Account'),
    type: normalizeAccountType(row.type ?? row.account_type),
    maskedNumber: normalizeMaskedAccount(maskedNumber),
    status: normalizeAccountStatus(row.status),
    routingNumber:
      normalizeAccountType(row.type ?? row.account_type) === 'Credit'
        ? undefined
        : asString(row.routingNumber) || asString(row.routing_number) || undefined,
    openedAt: asString(row.openedAt) || asString(row.opened_at) || asString(row.created_at),
    closeEligible,
    canClose,
    closeReasons,
    balances: {
      availableBalance: asNumber(availableBalance, 0),
      currentBalance: asNumber(currentBalance, 0),
    },
    isDefaultInternalReceive: asBoolean(row.isDefaultInternalReceive, asBoolean(row.is_default_internal_receive, false)),
  };
}

function normalizeTransactionType(value: unknown): Transaction['type'] {
  const normalized = asString(value).toLowerCase();
  if (normalized === 'bill_payment' || normalized === 'bill pay') return 'Bill Pay';
  if (normalized === 'deposit') return 'Deposit';
  if (normalized === 'withdrawal' || normalized === 'adjustment') return 'Withdrawal';
  if (normalized === 'atm' || normalized === 'fee') return 'ATM';
  if (normalized === 'interest') return 'Interest';
  return 'Transfer';
}

function normalizeTransactionStatus(value: unknown): Transaction['status'] {
  const normalized = asString(value).toLowerCase();
  if (normalized === 'completed' || normalized === 'posted') return 'COMPLETED';
  if (normalized === 'failed' || normalized === 'reversed') return 'FAILED';
  return 'PENDING';
}

function normalizeDirection(value: unknown): Transaction['direction'] {
  const normalized = asString(value).toLowerCase();
  if (normalized === 'credit' || normalized === 'in') return 'credit';
  return 'debit';
}

export function normalizeTransaction(input: unknown): Transaction {
  const row = asRecord(input);
  const amount = row.amount ?? centsToDollars(row.amount_cents);
  const rawType = row.type;

  return {
    id: asString(row.id),
    accountId: asString(row.accountId) || asString(row.account_id),
    description: asString(row.description) || toTitleCase(asString(rawType, 'Transfer')),
    amount: asNumber(amount, 0),
    direction: normalizeDirection(row.direction),
    status: normalizeTransactionStatus(row.status),
    type: normalizeTransactionType(rawType),
    postedAt: asString(row.postedAt) || asString(row.posted_at) || asString(row.created_at),
  };
}

function normalizeTransferStatus(value: unknown): TransferResult['status'] {
  const normalized = asString(value).toLowerCase();
  if (normalized === 'failed' || normalized === 'reversed') return 'FAILED';
  if (normalized === 'completed' || normalized === 'posted') return 'COMPLETED';
  return 'PENDING';
}

function normalizePaymentCadence(value: unknown): ScheduledPayment['cadence'] {
  const normalized = asString(value).toLowerCase();
  if (normalized === 'daily') return 'Daily';
  if (normalized === 'weekly') return 'Weekly';
  if (normalized === 'biweekly') return 'Biweekly';
  if (normalized === 'monthly') return 'Monthly';
  return 'Once';
}

function normalizePaymentStatus(value: unknown): ScheduledPayment['status'] {
  const normalized = asString(value).toLowerCase();
  if (normalized === 'processing') return 'PROCESSING';
  if (normalized === 'completed') return 'COMPLETED';
  if (normalized === 'failed') return 'FAILED';
  if (normalized === 'cancelled') return 'CANCELLED';
  return 'SCHEDULED';
}

export function normalizePayment(input: unknown): ScheduledPayment {
  const row = asRecord(input);
  const amount = row.amount ?? centsToDollars(row.amount_cents);
  return {
    id: asString(row.id),
    payeeId: asString(row.payeeId) || asString(row.payee_id),
    payeeName: asString(row.payeeName) || asString(asRecord(row.payee).name, 'Manual Payee'),
    accountId: asString(row.accountId) || asString(row.account_id),
    amount: asNumber(amount, 0),
    cadence: normalizePaymentCadence(row.cadence),
    deliverBy: asString(row.deliverBy) || asString(row.deliver_by) || asString(row.created_at),
    endDate: asString(row.endDate) || asString(row.end_date) || undefined,
    status: normalizePaymentStatus(row.status),
    failureReason: asString(row.failureReason) || asString(row.failure_reason) || undefined,
  };
}

export function normalizeTransferResult(input: unknown): TransferResult {
  const row = asRecord(input);
  return {
    id: asString(row.id),
    status: normalizeTransferStatus(row.status),
    submittedAt: asString(row.submittedAt) || asString(row.submitted_at),
  };
}

function normalizeTransferCadence(value: unknown): TransferPlan['cadence'] {
  const normalized = asString(value).toLowerCase();
  if (normalized === 'daily') return 'Daily';
  if (normalized === 'weekly') return 'Weekly';
  if (normalized === 'biweekly') return 'Biweekly';
  if (normalized === 'monthly') return 'Monthly';
  return 'Once';
}

function normalizeTransferPlanStatus(value: unknown): TransferPlan['status'] {
  const normalized = asString(value).toLowerCase();
  if (normalized === 'processing') return 'PROCESSING';
  if (normalized === 'completed') return 'COMPLETED';
  if (normalized === 'cancelled') return 'CANCELLED';
  return 'SCHEDULED';
}

export function normalizeTransferPlan(input: unknown): TransferPlan {
  const row = asRecord(input);
  const amount = row.amount ?? centsToDollars(row.amount_cents);
  return {
    id: asString(row.id),
    fromAccountId: asString(row.fromAccountId) || asString(row.from_account_id),
    toAccountId: asString(row.toAccountId) || asString(row.to_account_id),
    amount: asNumber(amount, 0),
    memo: asString(row.memo) || undefined,
    cadence: normalizeTransferCadence(row.cadence),
    startDate: asString(row.startDate) || asString(row.start_date),
    runTime: asString(row.runTime) || asString(row.run_time).slice(0, 5),
    timezone: asString(row.timezone, 'UTC'),
    endDate: asString(row.endDate) || asString(row.end_date) || undefined,
    nextRunAt: asString(row.nextRunAt) || asString(row.next_run_at) || undefined,
    lastRunAt: asString(row.lastRunAt) || asString(row.last_run_at) || undefined,
    lastFailureReason: asString(row.lastFailureReason) || asString(row.last_failure_reason) || undefined,
    status: normalizeTransferPlanStatus(row.status),
    createdAt: asString(row.createdAt) || asString(row.created_at),
    updatedAt: asString(row.updatedAt) || asString(row.updated_at),
  };
}

export function normalizeTransferSubmissionResult(input: unknown): TransferSubmissionResult {
  const row = asRecord(input);
  const mode = asString(row.mode).toUpperCase() === 'SCHEDULED' ? 'SCHEDULED' : 'NOW';
  const transfer = row.transfer ? normalizeTransferResult(row.transfer) : undefined;
  const plan = row.plan ? normalizeTransferPlan(row.plan) : undefined;
  return { mode, transfer, plan };
}

export function normalizeAccounts(input: unknown): BankAccount[] {
  if (!Array.isArray(input)) return [];
  return input.map(normalizeAccount);
}

export function normalizeTransactions(input: unknown): Transaction[] {
  if (!Array.isArray(input)) return [];
  return input.map(normalizeTransaction);
}

export function normalizeTransferPlans(input: unknown): TransferPlan[] {
  if (!Array.isArray(input)) return [];
  return input.map(normalizeTransferPlan);
}

export function normalizePayments(input: unknown): ScheduledPayment[] {
  if (!Array.isArray(input)) return [];
  return input.map(normalizePayment);
}

function normalizePlanStatus<T extends { status: string }>(status: unknown, fallback: T['status']): T['status'] {
  const normalized = asString(status).toUpperCase();
  if (normalized === 'PROCESSING' || normalized === 'COMPLETED' || normalized === 'CANCELLED') {
    return normalized as T['status'];
  }
  return fallback;
}

export function normalizeMemberTransferRecipient(input: unknown): MemberTransferRecipient {
  const row = asRecord(input);
  return {
    userId: asString(row.userId) || asString(row.user_id),
    displayName: asString(row.displayName) || asString(row.display_name),
    email: asString(row.email),
    defaultCheckingAccountMasked: asString(row.defaultCheckingAccountMasked) || asString(row.default_checking_account_masked),
  };
}

export function normalizeMemberTransfer(input: unknown): MemberTransfer {
  const row = asRecord(input);
  return {
    id: asString(row.id),
    fromAccountId: asString(row.fromAccountId) || asString(row.from_account_id),
    recipientUserId: asString(row.recipientUserId) || asString(row.recipient_user_id),
    recipientDisplayName: asString(row.recipientDisplayName) || asString(row.recipient_display_name),
    amount: asNumber(row.amount ?? centsToDollars(row.amount_cents), 0),
    memo: asString(row.memo) || undefined,
    transferDate: asString(row.transferDate) || asString(row.transfer_date),
    status: normalizeTransferStatus(row.status),
    submittedAt: asString(row.submittedAt) || asString(row.submitted_at),
    completedAt: asString(row.completedAt) || asString(row.completed_at) || undefined,
    failureReason: asString(row.failureReason) || asString(row.failure_reason) || undefined,
  };
}

export function normalizeMemberTransferPlan(input: unknown): MemberTransferPlan {
  const row = asRecord(input);
  return {
    id: asString(row.id),
    fromAccountId: asString(row.fromAccountId) || asString(row.from_account_id),
    recipientUserId: asString(row.recipientUserId) || asString(row.recipient_user_id),
    recipientEmail: asString(row.recipientEmail) || asString(row.recipient_email) || asString(row.recipient_handle),
    recipientDisplayName: asString(row.recipientDisplayName) || asString(row.recipient_display_name),
    amount: asNumber(row.amount ?? centsToDollars(row.amount_cents), 0),
    memo: asString(row.memo) || undefined,
    cadence: normalizeTransferCadence(row.cadence),
    startDate: asString(row.startDate) || asString(row.start_date),
    runTime: asString(row.runTime) || asString(row.run_time).slice(0, 5),
    timezone: asString(row.timezone, 'UTC'),
    endDate: asString(row.endDate) || asString(row.end_date) || undefined,
    nextRunAt: asString(row.nextRunAt) || asString(row.next_run_at) || undefined,
    lastRunAt: asString(row.lastRunAt) || asString(row.last_run_at) || undefined,
    lastFailureReason: asString(row.lastFailureReason) || asString(row.last_failure_reason) || undefined,
    status: normalizePlanStatus<MemberTransferPlan>(row.status, 'SCHEDULED'),
    createdAt: asString(row.createdAt) || asString(row.created_at),
    updatedAt: asString(row.updatedAt) || asString(row.updated_at),
  };
}

export function normalizeMemberTransferSubmissionResult(input: unknown): MemberTransferSubmissionResult {
  const row = asRecord(input);
  return {
    mode: asString(row.mode).toUpperCase() === 'SCHEDULED' ? 'SCHEDULED' : 'NOW',
    transfer: row.transfer ? normalizeMemberTransfer(row.transfer) : undefined,
    plan: row.plan ? normalizeMemberTransferPlan(row.plan) : undefined,
  };
}

export function normalizeMemberTransferPlans(input: unknown): MemberTransferPlan[] {
  if (!Array.isArray(input)) return [];
  return input.map(normalizeMemberTransferPlan);
}

export function normalizeExternalAccount(input: unknown): ExternalAccount {
  const row = asRecord(input);
  return {
    id: asString(row.id),
    bankName: asString(row.bankName) || asString(row.bank_name),
    nickname: asString(row.nickname),
    accountType: asString(row.accountType) === 'Savings' || asString(row.account_type).toLowerCase() === 'savings' ? 'Savings' : 'Checking',
    maskedAccountNumber: asString(row.maskedAccountNumber) || asString(row.masked_account_number),
    routingNumber: asString(row.routingNumber) || asString(row.routing_number),
    verificationStatus: asString(row.verificationStatus || row.verification_status).toUpperCase() === 'FAILED'
      ? 'FAILED'
      : asString(row.verificationStatus || row.verification_status).toUpperCase() === 'PENDING'
        ? 'PENDING'
        : 'VERIFIED',
    provider: asString(row.provider) || undefined,
    providerAccountId: asString(row.providerAccountId) || asString(row.provider_account_id) || undefined,
    isActive: asBoolean(row.isActive, asBoolean(row.is_active, true)),
    createdAt: asString(row.createdAt) || asString(row.created_at),
  };
}

export function normalizeExternalAccounts(input: unknown): ExternalAccount[] {
  if (!Array.isArray(input)) return [];
  return input.map(normalizeExternalAccount);
}

export function normalizeExternalTransfer(input: unknown): ExternalTransfer {
  const row = asRecord(input);
  const normalizedStatus = asString(row.status).toUpperCase();
  return {
    id: asString(row.id),
    fromAccountId: asString(row.fromAccountId) || asString(row.from_account_id),
    externalAccountId: asString(row.externalAccountId) || asString(row.external_account_id),
    externalAccountLabel: asString(row.externalAccountLabel) || asString(row.external_account_label),
    amount: asNumber(row.amount ?? centsToDollars(row.amount_cents), 0),
    memo: asString(row.memo) || undefined,
    transferDate: asString(row.transferDate) || asString(row.transfer_date),
    status: normalizedStatus === 'COMPLETED' || normalizedStatus === 'FAILED' || normalizedStatus === 'CANCELLED'
      ? normalizedStatus as ExternalTransfer['status']
      : 'PROCESSING',
    submittedAt: asString(row.submittedAt) || asString(row.submitted_at),
    processedAt: asString(row.processedAt) || asString(row.processed_at) || undefined,
    completedAt: asString(row.completedAt) || asString(row.completed_at) || undefined,
    settleAfter: asString(row.settleAfter) || asString(row.settle_after) || undefined,
    failureReason: asString(row.failureReason) || asString(row.failure_reason) || undefined,
  };
}

export function normalizeExternalTransferPlan(input: unknown): ExternalTransferPlan {
  const row = asRecord(input);
  return {
    id: asString(row.id),
    fromAccountId: asString(row.fromAccountId) || asString(row.from_account_id),
    externalAccountId: asString(row.externalAccountId) || asString(row.external_account_id),
    externalAccountLabel: asString(row.externalAccountLabel) || asString(row.external_account_label),
    amount: asNumber(row.amount ?? centsToDollars(row.amount_cents), 0),
    memo: asString(row.memo) || undefined,
    cadence: normalizeTransferCadence(row.cadence),
    startDate: asString(row.startDate) || asString(row.start_date),
    runTime: asString(row.runTime) || asString(row.run_time).slice(0, 5),
    timezone: asString(row.timezone, 'UTC'),
    endDate: asString(row.endDate) || asString(row.end_date) || undefined,
    nextRunAt: asString(row.nextRunAt) || asString(row.next_run_at) || undefined,
    lastRunAt: asString(row.lastRunAt) || asString(row.last_run_at) || undefined,
    lastFailureReason: asString(row.lastFailureReason) || asString(row.last_failure_reason) || undefined,
    status: normalizePlanStatus<ExternalTransferPlan>(row.status, 'SCHEDULED'),
    createdAt: asString(row.createdAt) || asString(row.created_at),
    updatedAt: asString(row.updatedAt) || asString(row.updated_at),
  };
}

export function normalizeExternalTransferSubmissionResult(input: unknown): ExternalTransferSubmissionResult {
  const row = asRecord(input);
  return {
    mode: asString(row.mode).toUpperCase() === 'SCHEDULED' ? 'SCHEDULED' : 'NOW',
    transfer: row.transfer ? normalizeExternalTransfer(row.transfer) : undefined,
    plan: row.plan ? normalizeExternalTransferPlan(row.plan) : undefined,
  };
}

export function normalizeExternalTransferPlans(input: unknown): ExternalTransferPlan[] {
  if (!Array.isArray(input)) return [];
  return input.map(normalizeExternalTransferPlan);
}

export function normalizeExternalTransfers(input: unknown): ExternalTransfer[] {
  if (!Array.isArray(input)) return [];
  return input.map(normalizeExternalTransfer);
}
