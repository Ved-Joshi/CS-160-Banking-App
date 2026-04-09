import { createContext } from 'react';
import type { RegistrationInput, User } from '../../types/banking';

export interface AuthContextValue {
  user: User | null;
  loading: boolean;
  rolesLoading: boolean;
  isAdmin: boolean;
  signIn: (email: string, password: string) => Promise<'ok'>;
  register: (input: RegistrationInput) => Promise<'ok'>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
