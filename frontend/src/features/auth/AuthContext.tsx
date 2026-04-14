import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session, User as SupabaseUser } from '@supabase/supabase-js';
import { SESSION_KEY, readStorage, writeStorage } from '../../lib/storage';
import { authService } from '../../lib/mockApi';
import { supabase } from '../../lib/supabaseClient';
import { apiRequest } from '../../lib/apiClient';
import type { RegistrationInput, User } from '../../types/banking';
import { AuthContext, type AuthContextValue } from './auth-context';

function getRoles(user: SupabaseUser): string[] {
  const metadata = (user.user_metadata as Record<string, unknown> | undefined) ?? {};
  const appMeta = (user.app_metadata as Record<string, unknown> | undefined) ?? {};
  if (Array.isArray(appMeta.roles)) {
    return appMeta.roles as string[];
  }
  if (Array.isArray(metadata.roles)) {
    return metadata.roles as string[];
  }
  return [];
}

function mapSessionUser(session: Session): User {
  const sessionUser = session.user;
  const metadata = (sessionUser.user_metadata as Record<string, unknown> | undefined) ?? {};
  return {
    id: sessionUser.id,
    email: sessionUser.email ?? '',
    username: (metadata.username as string | undefined) ?? '',
    firstName: (metadata.firstName as string | undefined) ?? '',
    middleName: (metadata.middleName as string | undefined) ?? '',
    lastName: (metadata.lastName as string | undefined) ?? '',
    roles: getRoles(sessionUser),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => readStorage<User | null>(SESSION_KEY, null));
  const [loading, setLoading] = useState<boolean>(true);
  const [rolesLoading, setRolesLoading] = useState<boolean>(true);
  const userId = user?.id;

  useEffect(() => {
    let active = true;

    const syncSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) return;

      const session = data.session;
      if (!session?.user) {
        writeStorage(SESSION_KEY, null);
        setUser(null);
        setRolesLoading(false);
        setLoading(false);
        return;
      }

      const hydrated = mapSessionUser(session);
      writeStorage(SESSION_KEY, hydrated);
      setUser(hydrated);
      setLoading(false);
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      if (!session?.user) {
        writeStorage(SESSION_KEY, null);
        setUser(null);
        setRolesLoading(false);
        setLoading(false);
        return;
      }

      const hydrated = mapSessionUser(session);
      writeStorage(SESSION_KEY, hydrated);
      setUser(hydrated);
      setLoading(false);
    });

    void syncSession();

    return () => {
      active = false;
      subscription.unsubscribe();
    };
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
    if (userId) {
      void loadRoles();
    } else {
      setRolesLoading(false);
    }
  }, [userId]);

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
        setLoading(false);
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
        setLoading(false);
        setRolesLoading(false);
        return 'ok';
      },
      async signOut() {
        await supabase.auth.signOut();
        writeStorage(SESSION_KEY, null);
        setUser(null);
        setLoading(false);
        setRolesLoading(false);
      },
    }),
    [loading, user, rolesLoading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
