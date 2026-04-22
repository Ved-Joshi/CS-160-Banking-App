import type {
  AtmLocation,
  AtmSearchInput,
  AtmSearchResponse,
  BankAccount,
  CreateBankAccountInput,
  CreateDepositInput,
  CreateDepositUploadUrlsInput,
  CreatePayeeInput,
  CreateScheduledPaymentInput,
  UpdateScheduledPaymentInput,
  CustomerProfile,
  Deposit,
  DepositUploadUrls,
  NotificationItem,
  Payee,
  ScheduledPayment,
  Transaction,
  TransferPlan,
  TransferRequest,
  TransferSubmissionResult,
} from '../types/banking';
import { apiRequest } from './apiClient';
import {
  normalizeAccount,
  normalizeAccounts,
  normalizePayment,
  normalizePayments,
  normalizeTransactions,
  normalizeTransferPlan,
  normalizeTransferPlans,
  normalizeTransferSubmissionResult,
} from './bankingContract';

export const profileService = {
  get(): Promise<CustomerProfile> {
    return apiRequest('/api/me/profile');
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
    return apiRequest('/api/deposits', {
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
  submit(input: TransferRequest): Promise<TransferSubmissionResult> {
    return apiRequest<unknown>('/api/transfers', {
      method: 'POST',
      body: input,
    }).then(normalizeTransferSubmissionResult);
  },
  listPlans(): Promise<TransferPlan[]> {
    return apiRequest<unknown[]>('/api/transfers/plans').then(normalizeTransferPlans);
  },
  cancelPlan(planId: string): Promise<TransferPlan> {
    return apiRequest<unknown>(`/api/transfers/plans/${planId}/cancel`, {
      method: 'POST',
    }).then(normalizeTransferPlan);
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
