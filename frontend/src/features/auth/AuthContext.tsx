import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { SESSION_KEY, readStorage, writeStorage } from '../../lib/storage';
import { authService } from '../../lib/mockApi';
import { supabase } from '../../lib/supabaseClient';
import type { RegistrationInput, User } from '../../types/banking';
import { AuthContext, type AuthContextValue } from './auth-context';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => readStorage<User | null>(SESSION_KEY, null));
  const loading = false;

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) return;

      const metadata = (data.user.user_metadata as Record<string, string> | undefined) ?? {};
      const hydrated: User = {
        id: data.user.id,
        email: data.user.email ?? '',
        username: metadata.username ?? '',
        firstName: metadata.firstName ?? '',
        lastName: metadata.lastName ?? '',
      };
      writeStorage(SESSION_KEY, hydrated);
      setUser(hydrated);
    });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      async signIn(email, password) {
        const nextUser = await authService.login(email, password);
        writeStorage(SESSION_KEY, nextUser);
        setUser(nextUser);
      },
      async completeMfa(code) {
        const nextUser = await authService.verifyMfa(code);
        writeStorage(SESSION_KEY, nextUser);
        setUser(nextUser);
      },
      async register(input: RegistrationInput) {
        const nextUser = await authService.register(input);
        writeStorage(SESSION_KEY, nextUser);
        setUser(nextUser);
      },
      async signOut() {
        await supabase.auth.signOut();
        writeStorage(SESSION_KEY, null);
        setUser(null);
      },
    }),
    [loading, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
