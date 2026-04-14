import { useRouter } from "expo-router";
import { useState } from "react";
import { Text } from "react-native";
import { Button, Card, Field, PageHeader, Row, Screen, StatusChip } from "../../../src/components/ui";
import { mockDeposits } from "../../../src/data/mockData";
import { formatCurrency, formatDateTime } from "../../../src/lib/format";

export default function DepositsScreen() {
  const router = useRouter();
  const [accountId, setAccountId] = useState("acct-checking");
  const [amount, setAmount] = useState("250");
  const [frontFileName, setFrontFileName] = useState("check-front.jpg");
  const [backFileName, setBackFileName] = useState("check-back.jpg");

  return (
    <Screen>
      <PageHeader title="Deposits" eyebrow="Mobile deposit" subtitle="Submit a check deposit and track the review status." />
      <Card>
        <Text style={{ fontWeight: "800", fontSize: 18 }}>Deposit a check</Text>
        <Field label="Deposit into" value={accountId} onChangeText={setAccountId} />
        <Field label="Amount" value={amount} onChangeText={setAmount} />
        <Field label="Front image upload" value={frontFileName} onChangeText={setFrontFileName} />
        <Field label="Back image upload" value={backFileName} onChangeText={setBackFileName} />
        <Button label="Submit deposit" onPress={() => router.push(`/deposits/${mockDeposits[0].id}`)} />
      </Card>
      <Card>
        <Text style={{ fontWeight: "800", fontSize: 18 }}>Recent deposits</Text>
        {mockDeposits.map((deposit) => (
          <Row
            key={deposit.id}
            title={deposit.id}
            subtitle={`${formatDateTime(deposit.submittedAt)} • ${formatCurrency(deposit.amount)}`}
            right={<StatusChip status={deposit.status} />}
            onPress={() => router.push(`/deposits/${deposit.id}`)}
          />
        ))}
      </Card>
    </Screen>
  );
}
