import type { AtmLocation, BankAccount, CustomerProfile, Deposit, ScheduledPayment, Transaction } from '../types/banking';
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
};

export const depositsService = {
  list(): Promise<Deposit[]> {
    return apiRequest('/api/deposits');
  },
};

export const atmService = {
  list(): Promise<AtmLocation[]> {
    return apiRequest('/api/atms', { auth: false });
  },
};
