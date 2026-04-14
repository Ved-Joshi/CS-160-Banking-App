import { useState } from "react";
import { Text } from "react-native";
import { Button, Card, Field, PageHeader, Screen } from "../../src/components/ui";

export default function TransfersScreen() {
  const [fromAccountId, setFromAccountId] = useState("acct-checking");
  const [toAccountId, setToAccountId] = useState("acct-savings");
  const [amount, setAmount] = useState("250");
  const [memo, setMemo] = useState("Monthly reserve");
  const [transferDate, setTransferDate] = useState(new Date().toISOString().slice(0, 10));
  const [submitted, setSubmitted] = useState(false);

  return (
    <Screen>
      <PageHeader title="Transfers" eyebrow="Move money" subtitle="Transfer funds between your own accounts with a review step before submission." />
      <Card>
        <Field label="From account" value={fromAccountId} onChangeText={setFromAccountId} />
        <Field label="To account" value={toAccountId} onChangeText={setToAccountId} />
        <Field label="Amount" value={amount} onChangeText={setAmount} />
        <Field label="Memo" value={memo} onChangeText={setMemo} />
        <Field label="Transfer date" value={transferDate} onChangeText={setTransferDate} />
        <Button label="Submit transfer" onPress={() => setSubmitted(true)} />
      </Card>
      <Card>
        <Text style={{ fontWeight: "800", fontSize: 18 }}>Transfer review</Text>
        <Text>From: {fromAccountId}</Text>
        <Text>To: {toAccountId}</Text>
        <Text>Amount: {amount}</Text>
        <Text>Date: {transferDate}</Text>
        {submitted ? <Text style={{ fontWeight: "700" }}>Transfer submitted.</Text> : <Text>Fill out the form to review before submitting.</Text>}
      </Card>
      <Card>
        <Text style={{ fontWeight: "800", fontSize: 18 }}>External transfers</Text>
        <Text>External account transfers are currently unavailable online. Contact support for additional transfer options.</Text>
      </Card>
    </Screen>
  );
}
