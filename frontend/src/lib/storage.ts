export const SESSION_KEY = 'sj-state-session';
export const MFA_CHALLENGE_KEY = 'sj-state-mfa-challenge';

export function readStorage<T>(key: string, fallback: T): T {
  const value = window.localStorage.getItem(key);

  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function writeStorage<T>(key: string, value: T): void {
  window.localStorage.setItem(key, JSON.stringify(value));
}
