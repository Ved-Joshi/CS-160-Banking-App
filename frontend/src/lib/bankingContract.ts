import type { BankAccount, Transaction, TransferPlan, TransferResult, TransferSubmissionResult } from '../types/banking';

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
    routingNumber: asString(row.routingNumber) || asString(row.routing_number) || 'N/A',
    openedAt: asString(row.openedAt) || asString(row.opened_at) || asString(row.created_at),
    closeEligible,
    canClose,
    closeReasons,
    balances: {
      availableBalance: asNumber(availableBalance, 0),
      currentBalance: asNumber(currentBalance, 0),
    },
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
