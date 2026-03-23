import { mockAccounts, mockAtms, mockDeposits, mockNotifications, mockPayments, mockPayees, mockTransactions } from '../mocks/data';
import { supabase, supabaseAnonKey, supabaseUrl } from './supabaseClient';
import { readStorage, writeStorage, MFA_CHALLENGE_KEY } from './storage';
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
    middleName: metadata.middleName ?? '',
    lastName: metadata.lastName ?? '',
  };
}

function formatAddress(metadata: Record<string, string>): string {
  const streetParts = [metadata.streetAddress, metadata.apartmentUnit].filter(Boolean).join(', ');
  const locality = [metadata.city, metadata.state, metadata.zipCode].filter(Boolean).join(', ').replace(', ,', ',');

  return [streetParts, locality].filter(Boolean).join(', ');
}

type MfaChallengeState = {
  factorId: string;
  challengeId: string;
};

function storeMfaChallenge(state: MfaChallengeState) {
  writeStorage(MFA_CHALLENGE_KEY, state);
}

function readMfaChallenge(): MfaChallengeState | null {
  return readStorage<MfaChallengeState | null>(MFA_CHALLENGE_KEY, null);
}

function clearMfaChallenge() {
  writeStorage(MFA_CHALLENGE_KEY, null);
}

async function createPhoneChallenge(factorId: string) {
  const { data, error } = await supabase.auth.mfa.challenge({ factorId });
  if (error || !data) {
    throw new Error(error?.message ?? 'Unable to start MFA challenge.');
  }
  storeMfaChallenge({ factorId, challengeId: data.id });
}

async function getPhoneFactorId(): Promise<string | null> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error || !data) return null;
  const phoneFactor =
    data.phone?.[0] ??
    data.all?.find((factor) => factor.factor_type === 'phone') ??
    null;
  return phoneFactor?.id ?? null;
}

export const authService = {
  async login(email: string, password: string): Promise<{ user: User; mfaRequired: boolean }> {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      throw new Error(error.message);
    }

    clearMfaChallenge();
    return { user: mapUser(data.user), mfaRequired: false };
  },
  async register(input: RegistrationInput): Promise<{ user: User; mfaRequired: boolean }> {
    const { data, error } = await supabase.auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        data: {
          firstName: input.firstName,
          middleName: input.middleName ?? '',
          lastName: input.lastName,
        },
      },
    });

    if (error) {
      throw new Error(error.message);
    }

    if (!data.session?.access_token) {
      throw new Error('Registration created the auth user, but no session was issued. Disable email confirmation in Supabase Auth or sign in after confirming the email before completing registration.');
    }

    const registrationResponse = await fetch(`${supabaseUrl}/functions/v1/complete_registration`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        apikey: supabaseAnonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: input.email,
        first_name: input.firstName,
        middle_name: input.middleName ?? null,
        last_name: input.lastName,
        mobile_phone_e164: input.mobilePhone,
        street_address: input.streetAddress,
        apartment_unit: input.apartmentUnit ?? null,
        city: input.city,
        state: input.state,
        zip_code: input.zipCode,
        date_of_birth: input.dateOfBirth,
        tax_identifier_raw: input.taxId,
      }),
    });

    if (!registrationResponse.ok) {
      let payload: { error?: string; message?: string } | null = null;

      try {
        payload = await registrationResponse.json() as { error?: string; message?: string };
      } catch {
        payload = null;
      }

      const message = payload?.error || payload?.message;
      if (message) {
        throw new Error(message);
      }

      const text = await registrationResponse.clone().text().catch(() => '');
      if (text) {
        throw new Error(text);
      }

      throw new Error(`Registration failed with status ${registrationResponse.status}.`);
    }

    clearMfaChallenge();
    return { user: mapUser(data.user), mfaRequired: false };
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

    const challenge = readMfaChallenge();
    if (!challenge) {
      throw new Error('No pending verification. Start sign-in again.');
    }

    const { data, error } = await supabase.auth.mfa.verify({
      factorId: challenge.factorId,
      challengeId: challenge.challengeId,
      code,
    });

    if (error) {
      throw new Error(error.message);
    }

    clearMfaChallenge();
    return mapUser(data?.user ?? (await supabase.auth.getUser()).data.user);
  },
  async resendMfa(): Promise<void> {
    const factorId = await getPhoneFactorId();
    if (!factorId) {
      throw new Error('No phone factor enrolled yet.');
    }
    await createPhoneChallenge(factorId);
  },
  async getProfile(): Promise<CustomerProfile> {
    const { data, error } = await supabase.auth.getUser();

    if (error || !data.user) {
      throw new Error(error?.message ?? 'No authenticated user.');
    }

    const user = mapUser(data.user);
    const metadata = (data.user.user_metadata as Record<string, string> | undefined) ?? {};
    const fullName = [user.firstName, user.middleName, user.lastName].filter(Boolean).join(' ').trim() || user.email;

    return {
      id: user.id,
      firstName: user.firstName,
      middleName: user.middleName,
      lastName: user.lastName,
      fullName,
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
