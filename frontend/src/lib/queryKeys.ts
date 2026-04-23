export const queryKeys = {
  accounts: () => ['accounts'] as const,
  account: (accountId: string) => ['accounts', accountId] as const,
  transactions: () => ['transactions'] as const,
  transferPlans: () => ['transfer-plans'] as const,
  memberTransferPlans: () => ['member-transfer-plans'] as const,
  externalAccounts: () => ['external-accounts'] as const,
  externalTransfers: () => ['external-transfers'] as const,
  externalTransferPlans: () => ['external-transfer-plans'] as const,
  notifications: () => ['notifications'] as const,
  payments: () => ['payments'] as const,
  payees: () => ['payees'] as const,
  deposits: () => ['deposits'] as const,
};
