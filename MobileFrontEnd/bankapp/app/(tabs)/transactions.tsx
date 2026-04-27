import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text } from "react-native";
import { Card, PageHeader, Row, Screen, SelectField, StatusChip } from "../../src/components/ui";
import { formatCurrency, formatDate } from "../../src/lib/format";
import { useTransactions, useAccounts } from "../../src/lib/hooks";
import type { TransactionStatus, TransactionType } from "../../src/types";

const TRANSACTIONS_MIN_REFRESH_MS = 15_000;

export default function TransactionsScreen() {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [type, setType] = useState<TransactionType | null>(null);
  const [status, setStatus] = useState<TransactionStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);
  const lastRefreshMsRef = useRef(0);

  const { accounts, refresh: refreshAccounts } = useAccounts();
  const { transactions, loading, refresh: refreshTransactions } = useTransactions();

  useEffect(() => {
    lastRefreshMsRef.current = Date.now();
  }, []);

  const onRefresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      await Promise.all([refreshAccounts(), refreshTransactions()]);
      lastRefreshMsRef.current = Date.now();
    } finally {
      setRefreshing(false);
      refreshingRef.current = false;
    }
  }, [refreshAccounts, refreshTransactions]);

  useFocusEffect(
    useCallback(() => {
      const now = Date.now();
      if (now - lastRefreshMsRef.current < TRANSACTIONS_MIN_REFRESH_MS) return;
      void onRefresh();
    }, [onRefresh])
  );

  const accountOptions = useMemo(
    () => [
      { label: "All accounts", value: null },
      ...accounts.map((a) => ({ label: `${a.nickname} (${a.type} ${a.maskedNumber})`, value: a.id })),
    ],
    [accounts]
  );

  const typeOptions = useMemo(
    () => {
      const options: TransactionType[] = ["Deposit", "Withdrawal", "Transfer", "Bill Pay", "ATM", "Interest"];
      return [{ label: "All types", value: null }, ...options.map((v) => ({ label: v, value: v }))];
    },
    []
  );

  const statusOptions = useMemo(
    () => {
      const options: TransactionStatus[] = ["PENDING", "COMPLETED", "FAILED"];
      return [{ label: "All statuses", value: null }, ...options.map((v) => ({ label: v, value: v }))];
    },
    []
  );

  const filtered = useMemo(
    () =>
      transactions.filter((txn) => {
        return (accountId === null || txn.accountId === accountId) && (type === null || txn.type === type) && (status === null || txn.status === status);
      }),
    [accountId, status, type, transactions]
  );

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <PageHeader title="Transactions" eyebrow="Activity history" subtitle="Filter and review posted, pending, and failed account activity." />
      <Card>
        <SelectField label="Account" value={accountId} options={accountOptions} onChange={setAccountId} />
        <SelectField label="Type" value={type} options={typeOptions} onChange={setType} />
        <SelectField label="Status" value={status} options={statusOptions} onChange={setStatus} />
      </Card>
      <Card>
        {loading ? (
          <Text>Loading transactions...</Text>
        ) : filtered.length === 0 ? (
          <Text>No transactions found.</Text>
        ) : (
          filtered.map((txn) => (
          <Row
            key={txn.id}
            title={txn.description}
            subtitle={`${formatDate(txn.postedAt)} � ${txn.type}`}
            right={
              <>
                <Text>{txn.direction === "credit" ? "+" : "-"}{formatCurrency(txn.amount)}</Text>
                <StatusChip status={txn.status} />
              </>
            }
          />
        ))
        )}
      </Card>
    </Screen>
  );
}
