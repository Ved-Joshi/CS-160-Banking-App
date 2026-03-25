import type {
  AtmLocation,
  AtmSearchInput,
  AtmSearchResponse,
  BankAccount,
  CreateBankAccountInput,
  CreateDepositInput,
  CreateDepositUploadUrlsInput,
  CreateScheduledPaymentInput,
  CustomerProfile,
  Deposit,
  DepositUploadUrls,
  NotificationItem,
  Payee,
  ScheduledPayment,
  Transaction,
  TransferRequest,
  TransferResult,
} from '../types/banking';
import { apiRequest } from './apiClient';

export const profileService = {
  get(): Promise<CustomerProfile> {
    return apiRequest('/api/me/profile');
  },
};

export const accountsService = {
  list(): Promise<BankAccount[]> {
    return apiRequest('/api/accounts');
  },
  get(accountId: string): Promise<BankAccount> {
    return apiRequest(`/api/accounts/${accountId}`);
  },
  create(input: CreateBankAccountInput): Promise<BankAccount> {
    return apiRequest('/api/accounts', {
      method: 'POST',
      body: input,
    });
  },
};

export const transactionsService = {
  list(): Promise<Transaction[]> {
    return apiRequest('/api/transactions');
  },
  search(filters: {
    accountId?: string;
    type?: string;
    status?: string;
    limit?: number;
  } = {}): Promise<Transaction[]> {
    return apiRequest('/api/transactions', {
      query: {
        account_id: filters.accountId,
        type: filters.type,
        status: filters.status,
        limit: filters.limit,
      },
    });
  },
};

export const paymentsService = {
  list(): Promise<ScheduledPayment[]> {
    return apiRequest('/api/payments');
  },
  create(input: CreateScheduledPaymentInput): Promise<ScheduledPayment> {
    return apiRequest('/api/payments', {
      method: 'POST',
      body: input,
    });
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
    return apiRequest('/api/transfers', {
      method: 'POST',
      body: input,
    });
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
