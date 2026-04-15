import { Text } from "react-native";
import { Card, PageHeader, Screen } from "../../../src/components/ui";
import { usePayees } from "../../../src/lib/hooks";

export default function PayeesScreen() {
  const { payees, loading } = usePayees();

  return (
    <Screen>
      <PageHeader title="Payees" eyebrow="Billing relationships" subtitle="Reference payees available for scheduled payments." />
      {loading ? (
        <Card>
          <Text>Loading payees...</Text>
        </Card>
      ) : payees.length === 0 ? (
        <Card>
          <Text>No payees found.</Text>
        </Card>
      ) : (
        payees.map((payee) => (
          <Card key={payee.id}>
            <Text style={{ fontWeight: "800" }}>{payee.category}</Text>
            <Text style={{ fontWeight: "700", fontSize: 18 }}>{payee.name}</Text>
            <Text>Account {payee.accountMask}</Text>
          </Card>
        ))
      )}
    </Screen>
  );
}
