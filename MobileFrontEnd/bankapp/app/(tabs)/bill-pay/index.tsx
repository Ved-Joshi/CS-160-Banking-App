import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Text } from "react-native";
import { Button, Card, Field, LinkButton, PageHeader, Row, Screen, StatusChip } from "../../../src/components/ui";
import { formatCurrency, formatDate } from "../../../src/lib/format";
import { usePayees, useBillPayments, useAccounts } from "../../../src/lib/hooks";

export default function BillPayScreen() {
  const router = useRouter();
  const { payees, loading: payeesLoading } = usePayees();
  const { payments, loading: paymentsLoading, createPayment, error: paymentError } = useBillPayments();
  const { accounts } = useAccounts();
  
  const [payeeId, setPayeeId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [cadence, setCadence] = useState("monthly");
  const [deliverBy, setDeliverBy] = useState(new Date().toISOString().slice(0, 10));
  
  const handleSchedulePayment = async () => {
    if (!payeeId || !accountId || !amount) {
      Alert.alert("Error", "Please fill in all required fields");
      return;
    }
    
    try {
      await createPayment(payeeId, accountId, parseFloat(amount), cadence as any, deliverBy);
      Alert.alert("Success", "Payment scheduled successfully");
      setAmount("");
    } catch (err) {
      Alert.alert("Error", paymentError || "Failed to schedule payment");
    }
  };

  return (
    <Screen>
      <PageHeader
        title="Bill Pay"
        eyebrow="Scheduled payments"
        subtitle="Manage payees and schedule one-time or recurring bill payments."
      />
      <LinkButton label="View payees" onPress={() => router.push("/bill-pay/payees")} />

      {payeesLoading ? (
        <Card>
          <Text>Loading payees...</Text>
        </Card>
      ) : (
        <>
          <Card>
            <Text style={{ fontWeight: "800", fontSize: 18 }}>Schedule payment</Text>
            <Field label="Payee" value={payeeId} onChangeText={setPayeeId} />
            <Field label="Pay from" value={accountId} onChangeText={setAccountId} />
            <Field label="Amount" value={amount} onChangeText={setAmount} />
            <Field label="Cadence" value={cadence} onChangeText={setCadence} />
            <Field label="Deliver by" value={deliverBy} onChangeText={setDeliverBy} />
            <Button label="Schedule payment" onPress={handleSchedulePayment} disabled={paymentsLoading} />
          </Card>

          <Card>
            <Text style={{ fontWeight: "800", fontSize: 18 }}>Scheduled payments</Text>
            {payments.length === 0 ? (
              <Text>No scheduled payments yet.</Text>
            ) : (
              payments.map((payment) => (
          <Row
            key={payment.id}
            title={payment.payeeName}
            subtitle={`${formatDate(payment.deliverBy)} � ${payment.cadence}`}
            right={
              <>
                <Text>{formatCurrency(payment.amount)}</Text>
                <StatusChip status={payment.status} />
              </>
            }
          />
              ))
            )}
          </Card>
        </>
      )}
    </Screen>
  );
}
