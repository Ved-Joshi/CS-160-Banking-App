import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Text } from "react-native";
import { Button, Card, Field, PageHeader, Row, Screen, StatusChip } from "../../../src/components/ui";
import { formatCurrency, formatDateTime } from "../../../src/lib/format";
import { useDeposits, useAccounts } from "../../../src/lib/hooks";

export default function DepositsScreen() {
  const router = useRouter();
  const { accounts, loading: accountsLoading } = useAccounts();
  const { deposits, loading: depositsLoading, submitDeposit, error: depositError } = useDeposits();
  
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [frontFileName, setFrontFileName] = useState("");
  const [backFileName, setBackFileName] = useState("");
  
  const handleSubmitDeposit = async () => {
    if (!accountId || !amount) {
      Alert.alert("Error", "Please select an account and enter an amount");
      return;
    }
    
    try {
      await submitDeposit(accountId, parseFloat(amount), undefined, frontFileName, backFileName);
      Alert.alert("Success", "Deposit submitted successfully");
      setAmount("");
      setFrontFileName("");
      setBackFileName("");
    } catch (err) {
      Alert.alert("Error", depositError || "Failed to submit deposit");
    }
  };

  return (
    <Screen>
      <PageHeader title="Deposits" eyebrow="Mobile deposit" subtitle="Submit a check deposit and track the review status." />
      {accountsLoading ? (
        <Card>
          <Text>Loading accounts...</Text>
        </Card>
      ) : (
        <>
          <Card>
            <Text style={{ fontWeight: "800", fontSize: 18 }}>Deposit a check</Text>
            <Field label="Deposit into" value={accountId} onChangeText={setAccountId} />
            <Field label="Amount" value={amount} onChangeText={setAmount} />
            <Field label="Front image upload" value={frontFileName} onChangeText={setFrontFileName} />
            <Field label="Back image upload" value={backFileName} onChangeText={setBackFileName} />
            <Button label="Submit deposit" onPress={handleSubmitDeposit} disabled={depositsLoading} />
          </Card>
          <Card>
            <Text style={{ fontWeight: "800", fontSize: 18 }}>Recent deposits</Text>
            {deposits.length === 0 ? (
              <Text>No deposits yet.</Text>
            ) : (
              deposits.map((deposit) => (
          <Row
            key={deposit.id}
            title={deposit.id}
            subtitle={`${formatDateTime(deposit.submittedAt)} � ${formatCurrency(deposit.amount)}`}
            right={<StatusChip status={deposit.status} />}
            onPress={() => router.push(`/deposits/${deposit.id}`)}
          />
              ))
            )}
          </Card>
        </>
      )}
    </Screen>
  );
}
