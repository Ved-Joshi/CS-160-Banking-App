import { mockAccounts, mockAtms, mockDeposits, mockNotifications, mockPayments, mockPayees, mockTransactions } from '../mocks/data';
import { supabase } from './supabaseClient';
import { readStorage, writeStorage } from './storage';
import type {
  AtmLocation,
  BankAccount,
  CustomerProfile,
  Deposit,
  NotificationItem,
  Payee,
  RegistrationInput,
  ScheduledPayment,
  Transaction,
  TransferRequest,
  TransferResult,
  User,
} from '../types/banking';
import type { User as SupabaseUser } from '@supabase/supabase-js';

const PAYMENTS_KEY = 'sj-state-payments';
const DEPOSITS_KEY = 'sj-state-deposits';
const NOTIFICATIONS_KEY = 'sj-state-notifications';

function delay<T>(value: T, timeout = 250): Promise<T> {
  return new Promise((resolve) => {
    window.setTimeout(() => resolve(value), timeout);
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

function mapUser(user: SupabaseUser | null): User {
  if (!user) {
    throw new Error('Unable to find an authenticated Supabase user.');
  }

  const metadata = (user.user_metadata as Record<string, string> | undefined) ?? {};
  return {
    id: user.id,
    email: user.email ?? '',
    username: metadata.username ?? '',
    firstName: metadata.firstName ?? '',
    lastName: metadata.lastName ?? '',
  };
}

function formatAddress(metadata: Record<string, string>): string {
  const streetParts = [metadata.streetAddress, metadata.apartmentUnit].filter(Boolean).join(', ');
  const locality = [metadata.city, metadata.state, metadata.zipCode].filter(Boolean).join(', ').replace(', ,', ',');

  return [streetParts, locality].filter(Boolean).join(', ');
}

export const authService = {
  async login(email: string, password: string): Promise<User> {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      throw new Error(error.message);
    }

    return mapUser(data.user);
  },
  async register(input: RegistrationInput): Promise<User> {
    const { data, error } = await supabase.auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        data: {
          username: input.username,
          mobilePhone: input.mobilePhone,
          streetAddress: input.streetAddress,
          apartmentUnit: input.apartmentUnit ?? '',
          city: input.city,
          state: input.state,
          zipCode: input.zipCode,
          // Keep high-risk onboarding fields out of auth metadata.
          taxIdLast4: input.taxId.slice(-4),
        },
      },
    });

    if (error) {
      throw new Error(error.message);
    }

    return mapUser(data.user);
  },
  async requestReset(email: string): Promise<{ email: string }> {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (error) {
      throw new Error(error.message);
    }

    return { email };
  },
  async verifyMfa(code: string): Promise<User> {
    if (code.length !== 6) {
      throw new Error('Enter the 6-digit security code.');
    }

    const currentUser = (await supabase.auth.getUser()).data.user;
    const email = currentUser?.email;

    if (!email) {
      throw new Error('No pending verification. Start sign-in again.');
    }

    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: 'email',
    });

    if (error) {
      throw new Error(error.message);
    }

    return mapUser(data.user ?? currentUser);
  },
  async getProfile(): Promise<CustomerProfile> {
    const { data, error } = await supabase.auth.getUser();

    if (error || !data.user) {
      throw new Error(error?.message ?? 'No authenticated user.');
    }

    const user = mapUser(data.user);
    const metadata = (data.user.user_metadata as Record<string, string> | undefined) ?? {};
    const fullName = `${user.firstName} ${user.lastName}`.trim() || user.username || user.email;

    return {
      id: user.id,
      fullName,
      username: user.username,
      email: user.email,
      phone: metadata.mobilePhone || data.user.phone || '—',
      address: formatAddress(metadata) || '—',
      memberSince: data.user.created_at,
      mfaEnabled: false,
    };
  },
};

export const accountsService = {
  async list(): Promise<BankAccount[]> {
    return delay(mockAccounts);
  },
  async get(accountId: string): Promise<BankAccount | undefined> {
    return delay(mockAccounts.find((account) => account.id === accountId));
  },
};

export const transactionsService = {
  async list(): Promise<Transaction[]> {
    return delay(mockTransactions);
  },
};

export const transfersService = {
  async submit(request: TransferRequest): Promise<TransferResult> {
    if (request.fromAccountId === request.toAccountId) {
      throw new Error('Choose two different accounts.');
    }

    if (request.amount <= 0) {
      throw new Error('Transfer amount must be greater than zero.');
    }

    return delay({
      id: `transfer-${Date.now()}`,
      status: request.amount > 2500 ? 'PENDING' : 'COMPLETED',
      submittedAt: nowIso(),
    });
  },
};

export const billPayService = {
  async listPayees(): Promise<Payee[]> {
    return delay(mockPayees);
  },
  async listPayments(): Promise<ScheduledPayment[]> {
    const stored = readStorage<ScheduledPayment[]>(PAYMENTS_KEY, mockPayments);
    return delay(stored);
  },
  async createPayment(payment: Omit<ScheduledPayment, 'id' | 'payeeName' | 'status'>): Promise<ScheduledPayment> {
    const payee = mockPayees.find((entry) => entry.id === payment.payeeId);
    const current = readStorage<ScheduledPayment[]>(PAYMENTS_KEY, mockPayments);
    const next: ScheduledPayment = {
      ...payment,
      id: `payment-${Date.now()}`,
      payeeName: payee?.name ?? 'Manual Payee',
      status: 'SCHEDULED',
    };
    writeStorage(PAYMENTS_KEY, [next, ...current]);
    return delay(next);
  },
};

export const depositsService = {
  async list(): Promise<Deposit[]> {
    return delay(readStorage<Deposit[]>(DEPOSITS_KEY, mockDeposits));
  },
  async get(depositId: string): Promise<Deposit | undefined> {
    const items = readStorage<Deposit[]>(DEPOSITS_KEY, mockDeposits);
    return delay(items.find((deposit) => deposit.id === depositId));
  },
  async create(input: Pick<Deposit, 'accountId' | 'amount'> & { frontFileName: string; backFileName: string }): Promise<Deposit> {
    const items = readStorage<Deposit[]>(DEPOSITS_KEY, mockDeposits);
    const created: Deposit = {
      id: `dep-${Date.now()}`,
      accountId: input.accountId,
      amount: input.amount,
      submittedAt: nowIso(),
      status: 'PENDING_REVIEW',
      note: 'Submitted successfully. Review typically completes in 1 business day.',
      images: {
        front: { id: `front-${Date.now()}`, fileName: input.frontFileName, capturedAt: nowIso() },
        back: { id: `back-${Date.now()}`, fileName: input.backFileName, capturedAt: nowIso() },
      },
    };
    writeStorage(DEPOSITS_KEY, [created, ...items]);
    return delay(created);
  },
};

export const atmService = {
  async list(): Promise<AtmLocation[]> {
    return delay(mockAtms);
  },
};

export const notificationsService = {
  async list(): Promise<NotificationItem[]> {
    return delay(readStorage<NotificationItem[]>(NOTIFICATIONS_KEY, mockNotifications));
  },
  async markRead(id: string): Promise<void> {
    const items = readStorage<NotificationItem[]>(NOTIFICATIONS_KEY, mockNotifications).map((item) =>
      item.id === id ? { ...item, read: true } : item,
    );
    writeStorage(NOTIFICATIONS_KEY, items);
    return delay(undefined);
  },
};
