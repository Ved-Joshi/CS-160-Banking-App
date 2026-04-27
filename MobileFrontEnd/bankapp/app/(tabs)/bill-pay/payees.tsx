import { Alert, Text } from "react-native";
import { Button, Card, Field, PageHeader, Screen } from "../../../src/components/ui";
import { usePayees } from "../../../src/lib/hooks";
import { useState } from "react";

export default function PayeesScreen() {
  const { payees, loading, createPayee, error } = usePayees();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Utilities");
  const [routingNumber, setRoutingNumber] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [confirmAccountNumber, setConfirmAccountNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleAddPayee = async () => {
    const payload = {
      name: name.trim(),
      category: category.trim() || "Other",
      routingNumber: routingNumber.trim(),
      accountNumber: accountNumber.trim(),
      confirmAccountNumber: confirmAccountNumber.trim(),
    };

    if (!payload.name || payload.routingNumber.length !== 9 || payload.accountNumber.length < 4) {
      Alert.alert("Check details", "Enter payee name, routing number (9 digits), and account number.");
      return;
    }

    if (payload.accountNumber !== payload.confirmAccountNumber) {
      Alert.alert("Mismatch", "Account number confirmation does not match.");
      return;
    }

    try {
      setSubmitting(true);
      await createPayee(payload);
      setName("");
      setRoutingNumber("");
      setAccountNumber("");
      setConfirmAccountNumber("");
      Alert.alert("Added", "Payee created.");
    } catch (err) {
      Alert.alert("Error", err instanceof Error ? err.message : error || "Failed to create payee");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen>
      <PageHeader title="Payees" eyebrow="Billing relationships" subtitle="Reference payees available for scheduled payments." />
      <Card>
        <Text style={{ fontWeight: "800", fontSize: 18 }}>Add payee</Text>
        <Field label="Name" value={name} onChangeText={setName} placeholder="Pacific Gas & Electric" />
        <Field label="Category" value={category} onChangeText={setCategory} placeholder="Utilities" />
        <Field label="Routing number (9 digits)" value={routingNumber} onChangeText={setRoutingNumber} placeholder="121000358" />
        <Field label="Account number" value={accountNumber} onChangeText={setAccountNumber} placeholder="1234567890" />
        <Field label="Confirm account number" value={confirmAccountNumber} onChangeText={setConfirmAccountNumber} placeholder="1234567890" />
        <Button label={submitting ? "Adding..." : "Add payee"} onPress={handleAddPayee} disabled={submitting || loading} />
      </Card>
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
