import { useLocalSearchParams, useRouter } from "expo-router";
import { Text } from "react-native";
import { Card, LinkButton, PageHeader, Row, Screen, StatusChip } from "../../../src/components/ui";
import { mockAccounts, mockTransactions } from "../../../src/data/mockData";
import { formatCurrency, formatDate } from "../../../src/lib/format";

export default function AccountDetailScreen() {
  const { accountId } = useLocalSearchParams<{ accountId: string }>();
  const router = useRouter();
  const account = mockAccounts.find((item) => item.id === accountId);

  if (!account) {
    return (
      <Screen>
        <Card>
          <Text style={{ fontWeight: "800" }}>Account not found</Text>
          <Text>Choose another account from the account summary page.</Text>
        </Card>
      </Screen>
    );
  }

  const rows = mockTransactions.filter((txn) => txn.accountId === account.id);

  return (
    <Screen>
      <PageHeader
        title={account.nickname}
        eyebrow={`${account.type} account`}
        subtitle={`${account.maskedNumber} | Routing ${account.routingNumber}`}
      />

      <Card>
        <Text style={{ fontWeight: "800", fontSize: 18 }}>Balance summary</Text>
        <Row title="Available balance" right={<Text>{formatCurrency(account.balances.availableBalance)}</Text>} />
        <Row title="Current balance" right={<Text>{formatCurrency(account.balances.currentBalance)}</Text>} />
        <Row title="Opened" right={<Text>{formatDate(account.openedAt)}</Text>} />
        <Row title="Status" right={<StatusChip status={account.status} />} />
      </Card>

      <Card>
        <Text style={{ fontWeight: "800", fontSize: 18 }}>Account options</Text>
        <Text>Close account remains unavailable until the balance is zero and all pending activity clears.</Text>
        <LinkButton label="Transfer funds" onPress={() => router.push("/transfers")} />
        <LinkButton label="Set up bill pay" onPress={() => router.push("/bill-pay")} />
        <LinkButton label="View statements and activity" onPress={() => router.push("/transactions")} />
      </Card>

      <Card>
        <Text style={{ fontWeight: "800", fontSize: 18 }}>Recent activity</Text>
        {rows.map((txn) => (
          <Row
            key={txn.id}
            title={txn.description}
            subtitle={`${formatDate(txn.postedAt)} • ${txn.type}`}
            right={<Text>{txn.direction === "credit" ? "+" : "-"}{formatCurrency(txn.amount)}</Text>}
          />
        ))}
      </Card>
    </Screen>
  );
}
