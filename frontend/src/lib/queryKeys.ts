export const queryKeys = {
  accounts: () => ['accounts'] as const,
  account: (accountId: string) => ['accounts', accountId] as const,
  transactions: () => ['transactions'] as const,
  notifications: () => ['notifications'] as const,
  payments: () => ['payments'] as const,
  deposits: () => ['deposits'] as const,
};
