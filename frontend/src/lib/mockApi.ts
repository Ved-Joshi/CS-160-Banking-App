import { supabase, supabaseAnonKey, supabaseUrl } from './supabaseClient';
import { readStorage, writeStorage, MFA_CHALLENGE_KEY } from './storage';
import type {
  RegistrationInput,
  User,
} from '../types/banking';
import type { User as SupabaseUser } from '@supabase/supabase-js';

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

type MfaChallengeState = {
  factorId: string;
  challengeId: string;
};

const relaxMfa = import.meta.env.DEV
  ? import.meta.env.VITE_RELAX_MFA !== 'false'
  : import.meta.env.VITE_RELAX_MFA === 'true';

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
    return { user: mapUser(data.user), mfaRequired: !relaxMfa && Boolean(await getPhoneFactorId()) };
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
      const raw = await registrationResponse.text().catch(() => '');
      let payload: { error?: string; message?: string } | null = null;

      try {
        payload = raw ? JSON.parse(raw) as { error?: string; message?: string } : null;
      } catch {
        payload = null;
      }

      const message = payload?.error || payload?.message;
      if (message) {
        throw new Error(message);
      }

      if (raw) {
        throw new Error(raw);
      }

      throw new Error(`Registration failed with status ${registrationResponse.status}.`);
    }

    clearMfaChallenge();
    return { user: mapUser(data.user), mfaRequired: !relaxMfa };
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
};
