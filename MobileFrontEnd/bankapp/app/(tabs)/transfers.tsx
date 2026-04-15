import { useState } from "react";
import { Alert, Text } from "react-native";
import { Button, Card, Field, PageHeader, Screen } from "../../src/components/ui";
import { useAccounts, useTransfers } from "../../src/lib/hooks";

export default function TransfersScreen() {
  const { accounts, loading: accountsLoading } = useAccounts();
  const { createTransfer, loading: transferLoading, error: transferError } = useTransfers();
  
  const [fromAccountId, setFromAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [transferDate, setTransferDate] = useState(new Date().toISOString().slice(0, 10));
  const [submitted, setSubmitted] = useState(false);
  
  const handleSubmit = async () => {
    if (!fromAccountId || !toAccountId || !amount) {
      Alert.alert("Error", "Please fill in all required fields");
      return;
    }
    
    try {
      await createTransfer(fromAccountId, toAccountId, parseFloat(amount), memo, transferDate);
      Alert.alert("Success", "Transfer submitted successfully");
      setSubmitted(true);
      setAmount("");
      setMemo("");
    } catch (err) {
      Alert.alert("Error", transferError || "Failed to submit transfer");
    }
  };

  return (
    <Screen>
      <PageHeader title="Transfers" eyebrow="Move money" subtitle="Transfer funds between your own accounts with a review step before submission." />
      {accountsLoading ? (
        <Card>
          <Text>Loading accounts...</Text>
        </Card>
      ) : (
        <>
          <Card>
            <Field label="From account" value={fromAccountId} onChangeText={setFromAccountId} />
            <Field label="To account" value={toAccountId} onChangeText={setToAccountId} />
            <Field label="Amount" value={amount} onChangeText={setAmount} />
            <Field label="Memo" value={memo} onChangeText={setMemo} />
            <Field label="Transfer date" value={transferDate} onChangeText={setTransferDate} />
            <Button label="Submit transfer" onPress={handleSubmit} disabled={transferLoading} />
          </Card>
          <Card>
            <Text style={{ fontWeight: "800", fontSize: 18 }}>Transfer review</Text>
            <Text>From: {accounts.find((a) => a.id === fromAccountId)?.nickname || "Select account"}</Text>
            <Text>To: {accounts.find((a) => a.id === toAccountId)?.nickname || "Select account"}</Text>
            <Text>Amount: {amount || "0.00"}</Text>
            <Text>Date: {transferDate}</Text>
            {submitted ? <Text style={{ fontWeight: "700" }}>Transfer submitted.</Text> : <Text>Fill out the form to review before submitting.</Text>}
          </Card>
        </>
      )}
      <Card>
        <Text style={{ fontWeight: "800", fontSize: 18 }}>External transfers</Text>
        <Text>External account transfers are currently unavailable online. Contact support for additional transfer options.</Text>
      </Card>
    </Screen>
  );
}
