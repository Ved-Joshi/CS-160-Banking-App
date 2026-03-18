import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import * as Linking from "expo-linking";
import type { User as SupabaseUser } from "@supabase/supabase-js";
import type { CustomerProfile, RegistrationInput, User } from "../types";
import { supabase } from "../lib/supabaseClient";

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
        if (!input.email.includes("@") || input.password.length < 8) {
          return "Use a valid email and at least 8 characters for password.";
        }

        const { data, error } = await supabase.auth.signUp({
          email: input.email,
          password: input.password,
          options: {
            data: {
              username: input.username ?? "",
              firstName: input.firstName ?? "",
              lastName: input.lastName ?? "",
              mobilePhone: input.mobilePhone ?? "",
              streetAddress: input.streetAddress ?? "",
              apartmentUnit: input.apartmentUnit ?? "",
              city: input.city ?? "",
              state: input.state ?? "",
              zipCode: input.zipCode ?? "",
              taxIdLast4: input.taxId ? input.taxId.slice(-4) : "",
            },
          },
        });

        if (error) {
          return error.message;
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
