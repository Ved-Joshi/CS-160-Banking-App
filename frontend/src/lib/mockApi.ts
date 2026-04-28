import { supabase, supabaseAnonKey, supabaseUrl } from './supabaseClient';
import type {
  RegistrationInput,
  User,
} from '../types/banking';
import type { User as SupabaseUser } from '@supabase/supabase-js';

function mapUser(user: SupabaseUser | null): User {
  if (!user) {
    throw new Error('Unable to find an authenticated Supabase user.');
  }

  const metadata = (user.user_metadata as Record<string, unknown> | undefined) ?? {};
  const appMeta = (user.app_metadata as Record<string, unknown> | undefined) ?? {};
  const rolesSource = Array.isArray(appMeta.roles)
    ? (appMeta.roles as string[])
    : Array.isArray(metadata.roles)
      ? (metadata.roles as string[])
      : [];
  return {
    id: user.id,
    email: user.email ?? '',
    username: (metadata.username as string | undefined) ?? '',
    firstName: (metadata.firstName as string | undefined) ?? '',
    middleName: (metadata.middleName as string | undefined) ?? '',
    lastName: (metadata.lastName as string | undefined) ?? '',
    roles: rolesSource,
  };
}

const normalizePhone = (phone: string) => {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
};

export const authService = {
  async login(email: string, password: string): Promise<{ user: User }> {
    const normalizedEmail = email.trim().toLowerCase();
    const { data, error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
    if (error) {
      throw new Error(error.message);
    }

    return { user: mapUser(data.user) };
  },
  async register(input: RegistrationInput): Promise<{ user: User }> {
    const normalizedPhone = normalizePhone(input.mobilePhone);
    const { data, error } = await supabase.auth.signUp({
      email: input.email,
      password: input.password,
      phone: normalizedPhone,
      options: {
        data: {
          firstName: input.firstName,
          middleName: input.middleName ?? '',
          lastName: input.lastName,
          mobilePhone: normalizedPhone,
          mobilePhoneE164: normalizedPhone,
          phone: normalizedPhone,
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
        mobile_phone_e164: normalizedPhone,
        street_address: input.streetAddress,
        apartment_unit: input.apartmentUnit ?? null,
        city: input.city,
        state: input.state,
        zip_code: input.zipCode,
        date_of_birth: input.dateOfBirth,
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

    return { user: mapUser(data.user) };
  },
  async requestReset(email: string): Promise<{ email: string }> {
    const normalizedEmail = email.trim().toLowerCase();
    const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (error) {
      throw new Error(error.message);
    }

    return { email: normalizedEmail };
  },
};
