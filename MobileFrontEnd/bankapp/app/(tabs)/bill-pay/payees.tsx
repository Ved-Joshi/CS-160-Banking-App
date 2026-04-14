import { Text } from "react-native";
import { Card, PageHeader, Screen } from "../../../src/components/ui";
import { mockPayees } from "../../../src/data/mockData";

export default function PayeesScreen() {
  return (
    <Screen>
      <PageHeader title="Payees" eyebrow="Billing relationships" subtitle="Reference payees available for scheduled payments." />
      {mockPayees.map((payee) => (
        <Card key={payee.id}>
          <Text style={{ fontWeight: "800" }}>{payee.category}</Text>
          <Text style={{ fontWeight: "700", fontSize: 18 }}>{payee.name}</Text>
          <Text>Account {payee.accountMask}</Text>
        </Card>
      ))}
    </Screen>
  );
}
