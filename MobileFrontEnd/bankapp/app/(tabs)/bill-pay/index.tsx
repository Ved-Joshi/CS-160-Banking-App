import { useRouter } from "expo-router";
import { useState } from "react";
import { Text } from "react-native";
import { Button, Card, Field, LinkButton, PageHeader, Row, Screen, StatusChip } from "../../../src/components/ui";
import { mockPayments } from "../../../src/data/mockData";
import { formatCurrency, formatDate } from "../../../src/lib/format";

export default function BillPayScreen() {
  const router = useRouter();
  const [payeeId, setPayeeId] = useState("payee-1");
  const [accountId, setAccountId] = useState("acct-checking");
  const [amount, setAmount] = useState("145");
  const [cadence, setCadence] = useState("Monthly");
  const [deliverBy, setDeliverBy] = useState(new Date().toISOString().slice(0, 10));

  return (
    <Screen>
      <PageHeader
        title="Bill Pay"
        eyebrow="Scheduled payments"
        subtitle="Manage payees and schedule one-time or recurring bill payments."
      />
      <LinkButton label="View payees" onPress={() => router.push("/bill-pay/payees")} />

      <Card>
        <Text style={{ fontWeight: "800", fontSize: 18 }}>Schedule payment</Text>
        <Field label="Payee" value={payeeId} onChangeText={setPayeeId} />
        <Field label="Pay from" value={accountId} onChangeText={setAccountId} />
        <Field label="Amount" value={amount} onChangeText={setAmount} />
        <Field label="Cadence" value={cadence} onChangeText={setCadence} />
        <Field label="Deliver by" value={deliverBy} onChangeText={setDeliverBy} />
        <Button label="Schedule payment" onPress={() => {}} />
      </Card>

      <Card>
        <Text style={{ fontWeight: "800", fontSize: 18 }}>Scheduled payments</Text>
        {mockPayments.map((payment) => (
          <Row
            key={payment.id}
            title={payment.payeeName}
            subtitle={`${formatDate(payment.deliverBy)} • ${payment.cadence}`}
            right={
              <>
                <Text>{formatCurrency(payment.amount)}</Text>
                <StatusChip status={payment.status} />
              </>
            }
          />
        ))}
      </Card>
    </Screen>
  );
}
