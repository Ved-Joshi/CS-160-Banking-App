import { createContext } from 'react';
import type { RegistrationInput, User } from '../../types/banking';

export interface AuthContextValue {
  user: User | null;
  loading: boolean;
  mfaPending: boolean;
  signIn: (email: string, password: string) => Promise<'ok' | 'mfa'>;
  completeMfa: (code: string) => Promise<void>;
  register: (input: RegistrationInput) => Promise<'ok' | 'mfa'>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
