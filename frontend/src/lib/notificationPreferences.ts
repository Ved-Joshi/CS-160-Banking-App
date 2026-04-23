import type { NotificationType } from '../types/banking';

export interface NotificationPreferences {
  deposit: boolean;
  payment: boolean;
  transfer: boolean;
  security: boolean;
  dailyDigest: boolean;
}

const STORAGE_KEY = 'sj.notification.preferences.v1';

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  deposit: true,
  payment: true,
  transfer: true,
  security: true,
  dailyDigest: false,
};

export function readNotificationPreferences(): NotificationPreferences {
  if (typeof window === 'undefined') {
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_NOTIFICATION_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<NotificationPreferences>;
    return {
      deposit: parsed.deposit ?? DEFAULT_NOTIFICATION_PREFERENCES.deposit,
      payment: parsed.payment ?? DEFAULT_NOTIFICATION_PREFERENCES.payment,
      transfer: parsed.transfer ?? DEFAULT_NOTIFICATION_PREFERENCES.transfer,
      security: parsed.security ?? DEFAULT_NOTIFICATION_PREFERENCES.security,
      dailyDigest: parsed.dailyDigest ?? DEFAULT_NOTIFICATION_PREFERENCES.dailyDigest,
    };
  } catch {
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }
}

export function writeNotificationPreferences(preferences: NotificationPreferences): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
}

export function isNotificationTypeEnabled(preferences: NotificationPreferences, type: NotificationType): boolean {
  return preferences[type];
}
