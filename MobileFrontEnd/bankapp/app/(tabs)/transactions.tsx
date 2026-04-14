import { useMemo, useState } from "react";
import { Text } from "react-native";
import { Card, Field, PageHeader, Row, Screen, StatusChip } from "../../src/components/ui";
import { mockTransactions } from "../../src/data/mockData";
import { formatCurrency, formatDate } from "../../src/lib/format";

export default function TransactionsScreen() {
  const [accountId, setAccountId] = useState("all");
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");

  const filtered = useMemo(
    () =>
      mockTransactions.filter((txn) => {
        return (accountId === "all" || txn.accountId === accountId) && (type === "all" || txn.type === type) && (status === "all" || txn.status === status);
      }),
    [accountId, status, type]
  );

  return (
    <Screen>
      <PageHeader title="Transactions" eyebrow="Activity history" subtitle="Filter and review posted, pending, and failed account activity." />
      <Card>
        <Field label="Account" value={accountId} onChangeText={setAccountId} />
        <Field label="Type" value={type} onChangeText={setType} />
        <Field label="Status" value={status} onChangeText={setStatus} />
      </Card>
      <Card>
        {filtered.map((txn) => (
          <Row
            key={txn.id}
            title={txn.description}
            subtitle={`${formatDate(txn.postedAt)} • ${txn.type}`}
            right={
              <>
                <Text>{txn.direction === "credit" ? "+" : "-"}{formatCurrency(txn.amount)}</Text>
                <StatusChip status={txn.status} />
              </>
            }
          />
        ))}
      </Card>
    </Screen>
  );
}
