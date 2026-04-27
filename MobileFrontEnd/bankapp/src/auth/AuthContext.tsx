import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import * as Linking from "expo-linking";
import type { User as SupabaseUser } from "@supabase/supabase-js";
import type { CustomerProfile, RegistrationInput, User } from "../types";
import { supabase, supabaseUrl } from "../lib/supabaseClient";

type AuthContextValue = {
  user: User | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<string | null>;
  register: (input: RegistrationInput) => Promise<string | null>;
  requestReset: (email: string) => Promise<string | null>;
  getProfile: () => Promise<CustomerProfile>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function readRegistrationError(response: Response): Promise<string> {
  const raw = await response.text();
  if (!raw) {
    return response.statusText || "Unable to finish registration.";
  }

  try {
    const payload = JSON.parse(raw) as Record<string, unknown>;
    const detail = payload.error ?? payload.message ?? payload.detail ?? payload;
    if (typeof detail === "string") {
      return detail;
    }
    return JSON.stringify(detail);
  } catch {
    return raw;
  }
}

function mapUser(user: SupabaseUser | null): User {
  if (!user) {
    throw new Error("Unable to find an authenticated Supabase user.");
  }

  const metadata = (user.user_metadata as Record<string, string> | undefined) ?? {};
  return {
    id: user.id,
    email: user.email ?? "",
    username: metadata.username ?? "",
    firstName: metadata.firstName ?? "",
    lastName: metadata.lastName ?? "",
  };
}

function formatAddress(metadata: Record<string, string>): string {
  const streetParts = [metadata.streetAddress, metadata.apartmentUnit].filter(Boolean).join(", ");
  const locality = [metadata.city, metadata.state, metadata.zipCode]
    .filter(Boolean)
    .join(", ")
    .replace(", ,", ",");

  return [streetParts, locality].filter(Boolean).join(", ");
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) {
        setUser(null);
        return;
      }
      const sessionUser = data.session?.user ?? null;
      setUser(sessionUser ? mapUser(sessionUser) : null);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      const sessionUser = session?.user ?? null;
      setUser(sessionUser ? mapUser(sessionUser) : null);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: Boolean(user),
      async login(email, password) {
        if (!email.includes("@") || password.length < 8) {
          return "Enter a valid email and password.";
        }

        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          return error.message;
        }

        try {
          const nextUser = mapUser(data.user);
          setUser(nextUser);
        } catch (err) {
          return err instanceof Error ? err.message : "Sign in failed.";
        }

        return null;
      },
      async register(input) {
        const firstName = input.firstName?.trim() ?? "";
        const lastName = input.lastName?.trim() ?? "";
        const email = input.email.trim();
        const password = input.password;
        const mobilePhone = input.mobilePhone?.trim() ?? "";
        const streetAddress = input.streetAddress?.trim() ?? "";
        const apartmentUnit = input.apartmentUnit?.trim() ?? "";
        const city = input.city?.trim() ?? "";
        const state = input.state?.trim().toUpperCase() ?? "";
        const zipCode = input.zipCode?.trim() ?? "";
        const dateOfBirth = input.dateOfBirth?.trim() ?? "";

        if (firstName.length < 2 || lastName.length < 2) {
          return "Enter first and last name.";
        }

        if (!email.includes("@") || password.length < 8) {
          return "Use a valid email and at least 8 characters for password.";
        }

        if (!/^[0-9]{10,15}$/.test(mobilePhone.replace(/\D/g, ""))) {
          return "Enter a valid phone number.";
        }

        if (!streetAddress || !city || state.length !== 2 || !/^[A-Z]{2}$/.test(state) || !/^\d{5}(?:-\d{4})?$/.test(zipCode)) {
          return "Provide a valid address, city, state, and ZIP code.";
        }

        if (!dateOfBirth || Number.isNaN(Date.parse(dateOfBirth))) {
          return "Enter a valid date of birth.";
        }

        const dob = new Date(dateOfBirth);
        const today = new Date();
        const adultCutoff = new Date(today.getFullYear() - 18, today.getMonth(), today.getDate());
        if (dob > adultCutoff) {
          return "You must be at least 18 years old.";
        }

        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              username: input.username ?? "",
              firstName,
              middleName: input.middleName?.trim() ?? "",
              lastName,
              mobilePhone,
              streetAddress,
              apartmentUnit,
              city,
              state,
              zipCode,
              dateOfBirth,
            },
          },
        });

        if (error) {
          return error.message;
        }

        const session = data.session ?? (await supabase.auth.signInWithPassword({ email, password })).data?.session;
        const token = session?.access_token;

        if (!token) {
          return "Registration created, but no active session was available. Please confirm your email before signing in.";
        }

        const completeResponse = await fetch(`${supabaseUrl}/functions/v1/complete_registration`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email,
            first_name: firstName,
            middle_name: input.middleName?.trim() || null,
            last_name: lastName,
            mobile_phone_e164: mobilePhone,
            street_address: streetAddress,
            apartment_unit: apartmentUnit || null,
            city,
            state,
            zip_code: zipCode,
            date_of_birth: dateOfBirth,
          }),
        });

        if (!completeResponse.ok) {
          const message = await readRegistrationError(completeResponse);
          await supabase.auth.signOut();
          setUser(null);
          return `Registration completed in auth, but profile setup failed: ${message}`;
        }

        try {
          const nextUser = mapUser(data.user);
          setUser(nextUser);
        } catch (err) {
          return err instanceof Error ? err.message : "Registration failed.";
        }

        return null;
      },
      async requestReset(email) {
        if (!email.includes("@")) {
          return "Enter a valid email address.";
        }

        const redirectTo = Linking.createURL("reset-password");
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
        if (error) {
          return error.message;
        }

        return null;
      },
      async getProfile() {
        const { data, error } = await supabase.auth.getUser();

        if (error || !data.user) {
          throw new Error(error?.message ?? "No authenticated user.");
        }

        const mappedUser = mapUser(data.user);
        const metadata = (data.user.user_metadata as Record<string, string> | undefined) ?? {};
        const fullName =
          `${mappedUser.firstName} ${mappedUser.lastName}`.trim() ||
          mappedUser.username ||
          mappedUser.email;

        return {
          id: mappedUser.id,
          fullName,
          username: mappedUser.username,
          email: mappedUser.email,
          phone: metadata.mobilePhone || data.user.phone || "-",
          address: formatAddress(metadata) || "-",
          memberSince: data.user.created_at,
          mfaEnabled: false,
        };
      },
      async signOut() {
        await supabase.auth.signOut();
        setUser(null);
      },
    }),
    [user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
