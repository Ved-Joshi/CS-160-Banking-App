import { useLocalSearchParams } from "expo-router";
import { Text } from "react-native";
import { Card, PageHeader, Row, Screen, StatusChip } from "../../../src/components/ui";
import { mockDeposits } from "../../../src/data/mockData";
import { formatCurrency, formatDateTime } from "../../../src/lib/format";

export default function DepositDetailScreen() {
  const { depositId } = useLocalSearchParams<{ depositId: string }>();
  const deposit = mockDeposits.find((item) => item.id === depositId);

  if (!deposit) {
    return (
      <Screen>
        <Card>
          <Text style={{ fontWeight: "800" }}>Deposit not found</Text>
          <Text>The requested deposit could not be located.</Text>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <PageHeader title={`Deposit ${deposit.id}`} eyebrow="Deposit tracking" subtitle="Follow review status and image submission details." />
      <Card>
        <Row title="Amount" right={<Text>{formatCurrency(deposit.amount)}</Text>} />
        <Row title="Submitted" right={<Text>{formatDateTime(deposit.submittedAt)}</Text>} />
        <Row title="Status" right={<StatusChip status={deposit.status} />} />
      </Card>
      <Card>
        <Text style={{ fontWeight: "800", fontSize: 18 }}>Status timeline</Text>
        <Text>1. Images uploaded</Text>
        <Text>2. Manual review</Text>
        <Text>3. Funds availability</Text>
        <Text>{deposit.note ?? "No additional notes"}</Text>
      </Card>
    </Screen>
  );
}
