import { useCallback, useEffect, useRef, useState } from "react";
import type {
  BankAccount,
  Transaction,
  Payee,
  ScheduledPayment,
  Deposit,
  AtmSearchResponse,
  AtmWithdrawalResult,
  CustomerProfile,
  UpdateCustomerProfileInput,
  ExternalAccount,
  ExternalLinkSession,
  ExternalTransfer,
  ExternalTransferPlan,
  ExternalTransferSubmissionResult,
} from "../types";
import * as api from "./api";

export function useAccounts() {
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.fetchAccounts();
      if (mountedRef.current) setAccounts(data);
    } catch (err) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : "Failed to load accounts");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createAccount = useCallback(async (type: "checking" | "savings" | "credit", nickname?: string) => {
    try {
      const newAccount = await api.createAccount(type, nickname);
      setAccounts((prev) => [newAccount, ...prev]);
      return newAccount;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create account";
      setError(message);
      throw err;
    }
  }, []);

  const closeAccount = useCallback(async (accountId: string) => {
    try {
      await api.closeAccount(accountId);
      setAccounts((prev) => prev.filter((a) => a.id !== accountId));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to close account";
      setError(message);
      throw err;
    }
  }, []);

  return { accounts, loading, error, refresh, createAccount, closeAccount };
}

export function useProfile() {
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.fetchProfile();
      if (mountedRef.current) setProfile(data);
    } catch (err) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : "Failed to load profile");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const update = useCallback(async (input: UpdateCustomerProfileInput) => {
    try {
      setLoading(true);
      setError(null);
      const updated = await api.updateProfile(input);
      if (mountedRef.current) setProfile(updated);
      return updated;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update profile";
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { profile, loading, error, refresh, update };
}

export function useTransactions(accountId?: string) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.fetchTransactions(accountId);
      if (mountedRef.current) setTransactions(data);
    } catch (err) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : "Failed to load transactions");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { transactions, loading, error, refresh };
}

export function useAtmWithdrawals() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async (accountId: string, amount: number): Promise<AtmWithdrawalResult> => {
    try {
      setLoading(true);
      setError(null);
      return await api.submitAtmWithdrawal(accountId, amount);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to submit ATM withdrawal";
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { loading, error, submit };
}

export function useTransfers() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createTransfer = useCallback(
    async (
      fromAccountId: string,
      toAccountId: string,
      amount: number,
      memo?: string,
      transferDate?: string
    ) => {
      try {
        setLoading(true);
        setError(null);
        const result = await api.createTransfer(fromAccountId, toAccountId, amount, memo, transferDate);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to create transfer";
        setError(message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return { loading, error, createTransfer };
}

export function usePayees() {
  const [payees, setPayees] = useState<Payee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.fetchPayees();
      if (mountedRef.current) setPayees(data);
    } catch (err) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : "Failed to load payees");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createPayee = useCallback(
    async (input: Parameters<typeof api.createPayee>[0]) => {
      try {
        setLoading(true);
        setError(null);
        const created = await api.createPayee(input);
        setPayees((prev) => [created, ...prev]);
        return created;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to create payee";
        setError(message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return { payees, loading, error, refresh, createPayee };
}

export function useBillPayments() {
  const [payments, setPayments] = useState<ScheduledPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.fetchBillPayments();
      if (mountedRef.current) setPayments(data);
    } catch (err) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : "Failed to load bill payments");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createPayment = useCallback(
    async (
      payeeId: string,
      accountId: string,
      amount: number,
      cadence: ScheduledPayment["cadence"],
      deliverBy: string
    ) => {
      try {
        setLoading(true);
        setError(null);
        const payment = await api.createBillPayment({ payeeId, accountId, amount, cadence, deliverBy });
        setPayments((prev) => [payment, ...prev]);
        return payment;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to create payment";
        setError(message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const cancelPayment = useCallback(async (paymentId: string) => {
    try {
      setLoading(true);
      setError(null);
      await api.cancelBillPayment(paymentId);
      setPayments((prev) => prev.filter((p) => p.id !== paymentId));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to cancel payment";
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const retryPayment = useCallback(async (paymentId: string) => {
    try {
      setLoading(true);
      setError(null);
      const updated = await api.retryBillPayment(paymentId);
      setPayments((prev) => prev.map((p) => (p.id === paymentId ? updated : p)));
      return updated;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to retry payment";
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { payments, loading, error, refresh, createPayment, cancelPayment, retryPayment };
}

export function useDeposits() {
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.fetchDeposits();
      if (mountedRef.current) setDeposits(data);
    } catch (err) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : "Failed to load deposits");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const submitDeposit = useCallback(
    async (input: api.CreateDepositInput) => {
      try {
        setLoading(true);
        setError(null);
        const deposit = await api.submitDeposit(input);
        setDeposits((prev) => [deposit, ...prev]);
        return deposit;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to submit deposit";
        setError(message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return { deposits, loading, error, refresh, submitDeposit };
}

export async function searchATMs(params: api.AtmSearchParams = {}): Promise<AtmSearchResponse> {
  return await api.searchATMs(params);
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.fetchNotifications();
      if (mountedRef.current) setNotifications(data);
    } catch (err) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : "Failed to load notifications");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const markAsRead = useCallback(async (notificationId: string) => {
    try {
      await api.markNotificationAsRead(notificationId);
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n))
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to mark notification as read";
      setError(message);
      throw err;
    }
  }, []);

  return { notifications, loading, error, refresh, markAsRead };
}

export function useMemberTransfers() {
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolveRecipient = useCallback(async (recipientEmail: string) => {
    try {
      setResolving(true);
      setError(null);
      const recipient = await api.resolveMemberRecipient(recipientEmail);
      return recipient;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to resolve recipient";
      setError(message);
      throw err;
    } finally {
      setResolving(false);
    }
  }, []);

  const createTransfer = useCallback(
    async (
      fromAccountId: string,
      recipientEmail: string,
      amount: number,
      memo?: string,
      scheduleMode?: string,
      transferDate?: string,
      cadence?: string,
      startDate?: string,
      runTime?: string,
      endDate?: string,
      timezone?: string
    ) => {
      try {
        setLoading(true);
        setError(null);
        const result = await api.createMemberTransfer(
          fromAccountId,
          recipientEmail,
          amount,
          memo,
          scheduleMode,
          transferDate,
          cadence,
          startDate,
          runTime,
          endDate,
          timezone
        );
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to create member transfer";
        setError(message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const fetchPlans = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      return await api.fetchMemberTransferPlans();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch member transfer plans";
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const cancelPlan = useCallback(async (planId: string) => {
    try {
      setLoading(true);
      setError(null);
      return await api.cancelMemberTransferPlan(planId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to cancel plan";
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const updatePlan = useCallback(async (planId: string, payload: Record<string, unknown>) => {
    try {
      setLoading(true);
      setError(null);
      return await api.updateMemberTransferPlan(planId, payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update plan";
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const retryPlan = useCallback(async (planId: string) => {
    try {
      setLoading(true);
      setError(null);
      return await api.retryMemberTransferPlan(planId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to retry plan";
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { loading, resolving, error, resolveRecipient, createTransfer, fetchPlans, cancelPlan, updatePlan, retryPlan };
}

export function useExternalAccounts() {
  const [accounts, setAccounts] = useState<ExternalAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.fetchExternalAccounts();
      if (mountedRef.current) setAccounts(data);
    } catch (err) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : "Failed to load external accounts");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(async (input: Parameters<typeof api.createExternalAccount>[0]) => {
    try {
      setLoading(true);
      setError(null);
      const created = await api.createExternalAccount(input);
      setAccounts((prev) => [created, ...prev]);
      return created;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to link external account";
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const createLinkSession = useCallback(async (): Promise<ExternalLinkSession> => {
    try {
      setLoading(true);
      setError(null);
      return await api.createExternalLinkSession();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start external link session";
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const completeLink = useCallback(async (accountId: string): Promise<ExternalAccount> => {
    try {
      setLoading(true);
      setError(null);
      const created = await api.completeExternalLink(accountId);
      setAccounts((prev) => [created, ...prev]);
      return created;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to complete external link";
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { accounts, loading, error, refresh, create, createLinkSession, completeLink };
}

export function useExternalTransfers() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async (input: Parameters<typeof api.submitExternalTransfer>[0]): Promise<ExternalTransferSubmissionResult> => {
    try {
      setLoading(true);
      setError(null);
      return await api.submitExternalTransfer(input);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to submit external transfer";
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const list = useCallback(async (): Promise<ExternalTransfer[]> => {
    try {
      setLoading(true);
      setError(null);
      return await api.fetchExternalTransfers();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch external transfers";
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const listPlans = useCallback(async (): Promise<ExternalTransferPlan[]> => {
    try {
      setLoading(true);
      setError(null);
      return await api.fetchExternalTransferPlans();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch external transfer plans";
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const cancelPlan = useCallback(async (planId: string): Promise<ExternalTransferPlan> => {
    try {
      setLoading(true);
      setError(null);
      return await api.cancelExternalTransferPlan(planId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to cancel external transfer plan";
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const updatePlan = useCallback(async (planId: string, payload: Record<string, unknown>): Promise<ExternalTransferPlan> => {
    try {
      setLoading(true);
      setError(null);
      return await api.updateExternalTransferPlan(planId, payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update external transfer plan";
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const retryPlan = useCallback(async (planId: string): Promise<ExternalTransferPlan> => {
    try {
      setLoading(true);
      setError(null);
      return await api.retryExternalTransferPlan(planId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to retry external transfer plan";
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { loading, error, submit, list, listPlans, cancelPlan, updatePlan, retryPlan };
}
