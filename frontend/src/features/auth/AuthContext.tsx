import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { SESSION_KEY, readStorage, writeStorage } from '../../lib/storage';
import { authService } from '../../lib/mockApi';
import { supabase } from '../../lib/supabaseClient';
import { apiRequest } from '../../lib/apiClient';
import type { RegistrationInput, User } from '../../types/banking';
import { AuthContext, type AuthContextValue } from './auth-context';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => readStorage<User | null>(SESSION_KEY, null));
  const loading = false;
  const [rolesLoading, setRolesLoading] = useState<boolean>(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const session = data.session;
      if (!session?.user) {
        setRolesLoading(false);
        return;
      }
      const metadata = (session.user.user_metadata as Record<string, unknown> | undefined) ?? {};
      const appMeta = (session.user.app_metadata as Record<string, unknown> | undefined) ?? {};
      const roles = Array.isArray(appMeta.roles)
        ? (appMeta.roles as string[])
        : Array.isArray(metadata.roles)
          ? (metadata.roles as string[])
          : [];
      const hydrated: User = {
        id: session.user.id,
        email: session.user.email ?? '',
        username: (metadata.username as string | undefined) ?? '',
        firstName: (metadata.firstName as string | undefined) ?? '',
        middleName: (metadata.middleName as string | undefined) ?? '',
        lastName: (metadata.lastName as string | undefined) ?? '',
        roles,
      };
      writeStorage(SESSION_KEY, hydrated);
      setUser(hydrated);
      setRolesLoading(false);
    });
  }, []);

  useEffect(() => {
    const loadRoles = async () => {
      setRolesLoading(true);
      try {
        const data = await apiRequest<{ isAdmin: boolean; roles: string[] }>('/api/me/admin');
        setUser((prev) => (prev ? { ...prev, roles: data.roles } : prev));
      } catch {
        // ignore; fallback to existing roles
      } finally {
        setRolesLoading(false);
      }
    };
    if (user) {
      void loadRoles();
    } else {
      setRolesLoading(false);
    }
  }, [user]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      rolesLoading,
      isAdmin: Boolean(user?.roles?.includes('admin')),
      async signIn(email, password) {
        const result = await authService.login(email, password);
        writeStorage(SESSION_KEY, result.user);
        setUser(result.user);
        setRolesLoading(true);
        // Refresh roles after login
        try {
          const data = await apiRequest<{ isAdmin: boolean; roles: string[] }>('/api/me/admin');
          setUser((prev) => (prev ? { ...prev, roles: data.roles } : prev));
        } catch {
          // ignore
        } finally {
          setRolesLoading(false);
        }
        return 'ok';
      },
      async register(input: RegistrationInput) {
        const result = await authService.register(input);
        writeStorage(SESSION_KEY, result.user);
        setUser(result.user);
        setRolesLoading(false);
        return 'ok';
      },
      async signOut() {
        await supabase.auth.signOut();
        writeStorage(SESSION_KEY, null);
        setUser(null);
        setRolesLoading(false);
      },
    }),
    [loading, user, rolesLoading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
