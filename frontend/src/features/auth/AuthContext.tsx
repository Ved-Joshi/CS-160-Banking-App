import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { MFA_CHALLENGE_KEY, SESSION_KEY, readStorage, writeStorage } from '../../lib/storage';
import { authService } from '../../lib/mockApi';
import { supabase } from '../../lib/supabaseClient';
import type { RegistrationInput, User } from '../../types/banking';
import { AuthContext, type AuthContextValue } from './auth-context';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => readStorage<User | null>(SESSION_KEY, null));
  const [mfaPending, setMfaPending] = useState<boolean>(() => Boolean(readStorage(MFA_CHALLENGE_KEY, null)));
  const loading = false;

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const session = data.session;
      if (!session?.user) return;
      if (session.aal !== 'aal2') {
        setMfaPending(true);
        return;
      }
      const metadata = (session.user.user_metadata as Record<string, string> | undefined) ?? {};
      const hydrated: User = {
        id: session.user.id,
        email: session.user.email ?? '',
        username: metadata.username ?? '',
        firstName: metadata.firstName ?? '',
        lastName: metadata.lastName ?? '',
      };
      writeStorage(SESSION_KEY, hydrated);
      setUser(hydrated);
      setMfaPending(false);
    });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      mfaPending,
      async signIn(email, password) {
        const result = await authService.login(email, password);
        if (result.mfaRequired) {
          setMfaPending(true);
          return 'mfa';
        }
        writeStorage(SESSION_KEY, result.user);
        setUser(result.user);
        setMfaPending(false);
        return 'ok';
      },
      async completeMfa(code) {
        const nextUser = await authService.verifyMfa(code);
        writeStorage(SESSION_KEY, nextUser);
        setUser(nextUser);
        setMfaPending(false);
      },
      async register(input: RegistrationInput) {
        const result = await authService.register(input);
        if (result.mfaRequired) {
          setMfaPending(true);
          return 'mfa';
        }
        writeStorage(SESSION_KEY, result.user);
        setUser(result.user);
        setMfaPending(false);
        return 'ok';
      },
      async signOut() {
        await supabase.auth.signOut();
        writeStorage(SESSION_KEY, null);
        writeStorage(MFA_CHALLENGE_KEY, null);
        setUser(null);
        setMfaPending(false);
      },
    }),
    [loading, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
