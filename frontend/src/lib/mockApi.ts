import { mockAccounts, mockAtms, mockDeposits, mockNotifications, mockPayments, mockPayees, mockProfile, mockTransactions, mockUser } from '../mocks/data';
import { readStorage, writeStorage } from './storage';
import type {
  AtmLocation,
  BankAccount,
  CustomerProfile,
  Deposit,
  NotificationItem,
  Payee,
  ScheduledPayment,
  Transaction,
  TransferRequest,
  TransferResult,
  User,
} from '../types/banking';

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

export const authService = {
  async login(email: string, password: string): Promise<User> {
    if (!email || password.length < 8) {
      throw new Error('Enter a valid email and password.');
    }

    return delay(mockUser);
  },
  async register(): Promise<User> {
    return delay(mockUser);
  },
  async requestReset(email: string): Promise<{ email: string }> {
    return delay({ email });
  },
  async verifyMfa(code: string): Promise<User> {
    if (code.length !== 6) {
      throw new Error('Enter the 6-digit security code.');
    }

    return delay(mockUser);
  },
  async getProfile(): Promise<CustomerProfile> {
    return delay(mockProfile);
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
