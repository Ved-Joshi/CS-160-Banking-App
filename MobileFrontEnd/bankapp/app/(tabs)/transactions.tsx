import { useMemo, useState } from "react";
import { Text } from "react-native";
import { Card, PageHeader, Row, Screen, SelectField, StatusChip } from "../../src/components/ui";
import { formatCurrency, formatDate } from "../../src/lib/format";
import { useTransactions, useAccounts } from "../../src/lib/hooks";
import type { TransactionStatus, TransactionType } from "../../src/types";

export default function TransactionsScreen() {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [type, setType] = useState<TransactionType | null>(null);
  const [status, setStatus] = useState<TransactionStatus | null>(null);
  
  const { accounts } = useAccounts();
  const { transactions, loading } = useTransactions();

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
    <Screen>
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
