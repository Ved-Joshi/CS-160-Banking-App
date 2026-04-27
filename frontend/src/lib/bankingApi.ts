import type {
  AtmLocation,
  AtmSearchInput,
  AtmSearchResponse,
  BankAccount,
  CreateAtmWithdrawalInput,
  CreateBankAccountInput,
  CreateDepositInput,
  CreateDepositUploadUrlsInput,
  CreatePayeeInput,
  CreateExternalAccountInput,
  CompleteExternalLinkInput,
  ExternalLinkSession,
  ExternalAccount,
  ExternalTransfer,
  ExternalTransferPlan,
  ExternalTransferRequest,
  ExternalTransferSubmissionResult,
  UpdateExternalTransferPlanInput,
  CreateScheduledPaymentInput,
  UpdateScheduledPaymentInput,
  CustomerProfile,
  Deposit,
  AtmWithdrawalResult,
  DepositUploadUrls,
  MemberTransferPlan,
  MemberTransferRecipient,
  MemberTransferRequest,
  MemberTransferSubmissionResult,
  UpdateMemberTransferPlanInput,
  NotificationItem,
  Payee,
  ScheduledPayment,
  Transaction,
  TransferRequest,
  UpdateCustomerProfileInput,
  TransferResult,
} from '../types/banking';
import { apiRequest } from './apiClient';
import {
  normalizeAccount,
  normalizeAccounts,
  normalizePayment,
  normalizePayments,
  normalizeExternalAccount,
  normalizeExternalAccounts,
  normalizeExternalTransferPlans,
  normalizeExternalTransfers,
  normalizeExternalTransferSubmissionResult,
  normalizeMemberTransferPlans,
  normalizeMemberTransferRecipient,
  normalizeMemberTransferSubmissionResult,
  normalizeTransactions,
} from './bankingContract';

function createIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `idem-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export const profileService = {
  get(): Promise<CustomerProfile> {
    return apiRequest('/api/me/profile');
  },
  update(input: UpdateCustomerProfileInput): Promise<CustomerProfile> {
    return apiRequest('/api/me/profile', {
      method: 'PATCH',
      body: input,
    });
  },
};

export const accountsService = {
  list(): Promise<BankAccount[]> {
    return apiRequest<unknown[]>('/api/accounts').then(normalizeAccounts);
  },
  get(accountId: string): Promise<BankAccount> {
    return apiRequest<unknown>(`/api/accounts/${accountId}`).then(normalizeAccount);
  },
  create(input: CreateBankAccountInput): Promise<BankAccount> {
    return apiRequest<unknown>('/api/accounts', {
      method: 'POST',
      body: input,
    }).then(normalizeAccount);
  },
  close(accountId: string): Promise<void> {
    return apiRequest(`/api/accounts/${accountId}/close`, {
      method: 'POST',
    });
  },
};

export const transactionsService = {
  list(): Promise<Transaction[]> {
    return apiRequest<unknown[]>('/api/transactions').then(normalizeTransactions);
  },
  search(filters: {
    accountId?: string;
    type?: string;
    status?: string;
    limit?: number;
  } = {}): Promise<Transaction[]> {
    return apiRequest<unknown[]>('/api/transactions', {
      query: {
        account_id: filters.accountId,
        type: filters.type,
        status: filters.status,
        limit: filters.limit,
      },
    }).then(normalizeTransactions);
  },
};

export const paymentsService = {
  list(): Promise<ScheduledPayment[]> {
    return apiRequest<unknown[]>('/api/payments').then(normalizePayments);
  },
  create(input: CreateScheduledPaymentInput): Promise<ScheduledPayment> {
    return apiRequest<unknown>('/api/payments', {
      method: 'POST',
      body: input,
      headers: { 'Idempotency-Key': createIdempotencyKey() },
    }).then(normalizePayment);
  },
  cancel(paymentId: string): Promise<ScheduledPayment> {
    return apiRequest<unknown>(`/api/payments/${paymentId}/cancel`, {
      method: 'POST',
    }).then(normalizePayment);
  },
  update(paymentId: string, input: UpdateScheduledPaymentInput): Promise<ScheduledPayment> {
    return apiRequest<unknown>(`/api/payments/${paymentId}`, {
      method: 'PATCH',
      body: input,
    }).then(normalizePayment);
  },
  retry(paymentId: string): Promise<ScheduledPayment> {
    return apiRequest<unknown>(`/api/payments/${paymentId}/retry`, {
      method: 'POST',
      headers: { 'Idempotency-Key': createIdempotencyKey() },
    }).then(normalizePayment);
  },
};

export const depositsService = {
  list(): Promise<Deposit[]> {
    return apiRequest('/api/deposits');
  },
  get(depositId: string): Promise<Deposit> {
    return apiRequest(`/api/deposits/${depositId}`);
  },
  createUploadUrls(input: CreateDepositUploadUrlsInput): Promise<DepositUploadUrls> {
    return apiRequest('/api/deposits/upload-urls', {
      method: 'POST',
      body: input,
    });
  },
  create(input: CreateDepositInput): Promise<Deposit> {
    const payload: CreateDepositInput = {
      accountId: input.accountId,
      amount: input.amount,
      depositMethod: input.depositMethod,
      depositType: input.depositType,
      frontImagePath: input.frontImagePath,
      backImagePath: input.backImagePath,
    };
    return apiRequest('/api/deposits', {
      method: 'POST',
      body: payload,
      headers: { 'Idempotency-Key': createIdempotencyKey() },
    });
  },
};

export const withdrawalsService = {
  submitAtm(input: CreateAtmWithdrawalInput): Promise<AtmWithdrawalResult> {
    return apiRequest<AtmWithdrawalResult>('/api/withdrawals/atm', {
      method: 'POST',
      body: input,
    });
  },
};

export const payeesService = {
  list(): Promise<Payee[]> {
    return apiRequest('/api/payees');
  },
  create(input: CreatePayeeInput): Promise<Payee> {
    return apiRequest('/api/payees', {
      method: 'POST',
      body: input,
    });
  },
};

export const notificationsService = {
  list(): Promise<NotificationItem[]> {
    return apiRequest('/api/notifications');
  },
  markRead(notificationId: string): Promise<NotificationItem> {
    return apiRequest(`/api/notifications/${notificationId}/read`, {
      method: 'POST',
    });
  },
};

export const transfersService = {
  submit(input: TransferRequest): Promise<TransferResult> {
    return apiRequest<unknown>('/api/transfers', {
      method: 'POST',
      body: input,
    }).then((result) => ({
      id: (result as { id?: string }).id ?? '',
      status: ((result as { status?: string }).status as TransferResult['status']) ?? 'PENDING',
      submittedAt: (result as { submittedAt?: string; submitted_at?: string }).submittedAt ?? (result as { submitted_at?: string }).submitted_at ?? '',
    }));
  },
};

export const memberTransfersService = {
  resolveRecipient(recipientEmail: string): Promise<MemberTransferRecipient> {
    return apiRequest<unknown>('/api/member-transfers/resolve-recipient', {
      method: 'POST',
      body: { recipientEmail },
    }).then(normalizeMemberTransferRecipient);
  },
  submit(input: MemberTransferRequest): Promise<MemberTransferSubmissionResult> {
    return apiRequest<unknown>('/api/member-transfers', {
      method: 'POST',
      body: input,
    }).then(normalizeMemberTransferSubmissionResult);
  },
  listPlans(): Promise<MemberTransferPlan[]> {
    return apiRequest<unknown[]>('/api/member-transfers/plans').then(normalizeMemberTransferPlans);
  },
  cancelPlan(planId: string): Promise<MemberTransferPlan> {
    return apiRequest<unknown>(`/api/member-transfers/plans/${planId}/cancel`, {
      method: 'POST',
    }).then((input) => normalizeMemberTransferPlans([input])[0]!);
  },
  updatePlan(planId: string, input: UpdateMemberTransferPlanInput): Promise<MemberTransferPlan> {
    return apiRequest<unknown>(`/api/member-transfers/plans/${planId}`, {
      method: 'PATCH',
      body: input,
    }).then((payload) => normalizeMemberTransferPlans([payload])[0]!);
  },
  retryPlan(planId: string): Promise<MemberTransferPlan> {
    return apiRequest<unknown>(`/api/member-transfers/plans/${planId}/retry`, {
      method: 'POST',
    }).then((payload) => normalizeMemberTransferPlans([payload])[0]!);
  },
};

export const externalAccountsService = {
  list(): Promise<ExternalAccount[]> {
    return apiRequest<unknown[]>('/api/external-accounts').then(normalizeExternalAccounts);
  },
  create(input: CreateExternalAccountInput): Promise<ExternalAccount> {
    return apiRequest<unknown>('/api/external-accounts', {
      method: 'POST',
      body: input,
    }).then(normalizeExternalAccount);
  },
  createLinkSession(): Promise<ExternalLinkSession> {
    return apiRequest<ExternalLinkSession>('/api/external-accounts/link-session', {
      method: 'POST',
    });
  },
  completeLink(input: CompleteExternalLinkInput): Promise<ExternalAccount> {
    return apiRequest<unknown>('/api/external-accounts/link-complete', {
      method: 'POST',
      body: input,
    }).then(normalizeExternalAccount);
  },
};

export const externalTransfersService = {
  submit(input: ExternalTransferRequest): Promise<ExternalTransferSubmissionResult> {
    return apiRequest<unknown>('/api/external-transfers', {
      method: 'POST',
      body: input,
    }).then(normalizeExternalTransferSubmissionResult);
  },
  list(): Promise<ExternalTransfer[]> {
    return apiRequest<unknown[]>('/api/external-transfers').then(normalizeExternalTransfers);
  },
  listPlans(): Promise<ExternalTransferPlan[]> {
    return apiRequest<unknown[]>('/api/external-transfers/plans').then(normalizeExternalTransferPlans);
  },
  cancelPlan(planId: string): Promise<ExternalTransferPlan> {
    return apiRequest<unknown>(`/api/external-transfers/plans/${planId}/cancel`, {
      method: 'POST',
    }).then((input) => normalizeExternalTransferPlans([input])[0]!);
  },
  updatePlan(planId: string, input: UpdateExternalTransferPlanInput): Promise<ExternalTransferPlan> {
    return apiRequest<unknown>(`/api/external-transfers/plans/${planId}`, {
      method: 'PATCH',
      body: input,
    }).then((payload) => normalizeExternalTransferPlans([payload])[0]!);
  },
  retryPlan(planId: string): Promise<ExternalTransferPlan> {
    return apiRequest<unknown>(`/api/external-transfers/plans/${planId}/retry`, {
      method: 'POST',
    }).then((payload) => normalizeExternalTransferPlans([payload])[0]!);
  },
};

export const atmService = {
  list(): Promise<AtmLocation[]> {
    return apiRequest('/api/atms', { auth: false });
  },
  search(input: AtmSearchInput): Promise<AtmSearchResponse> {
    return apiRequest('/api/atms/search', {
      auth: false,
      query: {
        lat: input.lat,
        lng: input.lng,
        query: input.query,
        radius_miles: input.radiusMiles,
        open_now: input.openNow === undefined ? undefined : String(input.openNow),
        limit: input.limit,
      },
    });
  },
};
