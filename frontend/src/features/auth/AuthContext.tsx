import { useMemo, useState, type ReactNode } from 'react';
import { SESSION_KEY, readStorage, writeStorage } from '../../lib/storage';
import { authService } from '../../lib/mockApi';
import type { User } from '../../types/banking';
import { AuthContext, type AuthContextValue } from './auth-context';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => readStorage<User | null>(SESSION_KEY, null));
  const loading = false;

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
      async register() {
        const nextUser = await authService.register();
        writeStorage(SESSION_KEY, nextUser);
        setUser(nextUser);
      },
      signOut() {
        writeStorage(SESSION_KEY, null);
        setUser(null);
      },
    }),
    [loading, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
