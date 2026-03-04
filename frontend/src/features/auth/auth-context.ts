import { createContext } from 'react';
import type { User } from '../../types/banking';

export interface AuthContextValue {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  completeMfa: (code: string) => Promise<void>;
  register: () => Promise<void>;
  signOut: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
