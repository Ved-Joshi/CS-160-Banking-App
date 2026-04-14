import { useRouter } from "expo-router";
import { Text, View } from "react-native";
import { Card, LinkButton, PageHeader, Screen, StatusChip } from "../../../src/components/ui";
import { mockAccounts } from "../../../src/data/mockData";
import { formatCurrency } from "../../../src/lib/format";

export default function AccountsScreen() {
  const router = useRouter();

  return (
    <Screen>
      <PageHeader
        title="Accounts"
        eyebrow="Balances and details"
        subtitle="Review current and available balances across your linked products."
      />
      {mockAccounts.map((account) => (
        <Card key={account.id}>
          <Text style={{ fontWeight: "800" }}>{account.type}</Text>
          <Text style={{ fontSize: 20, fontWeight: "800" }}>{account.nickname}</Text>
          <Text style={{ opacity: 0.8 }}>{account.maskedNumber}</Text>
          <View style={{ gap: 4 }}>
            <Text>Available: {formatCurrency(account.balances.availableBalance)}</Text>
            <Text>Current: {formatCurrency(account.balances.currentBalance)}</Text>
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <StatusChip status={account.status} />
            <LinkButton label="View activity" onPress={() => router.push(`/accounts/${account.id}`)} />
          </View>
        </Card>
      ))}
    </Screen>
  );
}
