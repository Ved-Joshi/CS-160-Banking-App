import { useCallback, useEffect, useState } from "react";
import type {
  BankAccount,
  Transaction,
  Payee,
  ScheduledPayment,
  Deposit,
  AtmLocation,
} from "../types";
import * as api from "./api";

export function useAccounts() {
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await api.fetchAccounts();
        if (active) setAccounts(data);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Failed to load accounts");
      } finally {
        if (active) setLoading(false);
      }
    };

    load();

    return () => {
      active = false;
    };
  }, []);

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

  return { accounts, loading, error, createAccount, closeAccount };
}

export function useTransactions(accountId?: string) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await api.fetchTransactions(accountId);
        if (active) setTransactions(data);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Failed to load transactions");
      } finally {
        if (active) setLoading(false);
      }
    };

    load();

    return () => {
      active = false;
    };
  }, [accountId]);

  return { transactions, loading, error };
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

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await api.fetchPayees();
        if (active) setPayees(data);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Failed to load payees");
      } finally {
        if (active) setLoading(false);
      }
    };

    load();

    return () => {
      active = false;
    };
  }, []);

  return { payees, loading, error };
}

export function useBillPayments() {
  const [payments, setPayments] = useState<ScheduledPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await api.fetchBillPayments();
        if (active) setPayments(data);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Failed to load bill payments");
      } finally {
        if (active) setLoading(false);
      }
    };

    load();

    return () => {
      active = false;
    };
  }, []);

  const createPayment = useCallback(
    async (
      payeeId: string,
      accountId: string,
      amount: number,
      cadence: "once" | "weekly" | "biweekly" | "monthly",
      deliverBy: string
    ) => {
      try {
        setLoading(true);
        setError(null);
        const payment = await api.createBillPayment(payeeId, accountId, amount, cadence, deliverBy);
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

  return { payments, loading, error, createPayment, cancelPayment };
}

export function useDeposits() {
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await api.fetchDeposits();
        if (active) setDeposits(data);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Failed to load deposits");
      } finally {
        if (active) setLoading(false);
      }
    };

    load();

    return () => {
      active = false;
    };
  }, []);

  const submitDeposit = useCallback(
    async (
      accountId: string,
      amount: number,
      note?: string,
      frontImagePath?: string,
      backImagePath?: string
    ) => {
      try {
        setLoading(true);
        setError(null);
        const deposit = await api.submitDeposit(accountId, amount, note, frontImagePath, backImagePath);
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

  return { deposits, loading, error, submitDeposit };
}

export async function searchATMs(query?: string, latitude?: number, longitude?: number) {
  return await api.searchATMs(query, latitude, longitude);
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await api.fetchNotifications();
        if (active) setNotifications(data);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Failed to load notifications");
      } finally {
        if (active) setLoading(false);
      }
    };

    load();

    return () => {
      active = false;
    };
  }, []);

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

  return { notifications, loading, error, markAsRead };
}
