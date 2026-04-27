import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, Modal, Pressable, Text, View } from "react-native";
import { Button, Card, Field, LinkButton, PageHeader, Row, Screen, StatusChip } from "../../../src/components/ui";
import { formatCurrency, formatDate } from "../../../src/lib/format";
import { useAccounts, useBillPayments, usePayees } from "../../../src/lib/hooks";
import type { ScheduledPayment } from "../../../src/types";

const CADENCE_OPTIONS: ScheduledPayment["cadence"][] = ["Once", "Daily", "Weekly", "Biweekly", "Monthly"];

export default function BillPayScreen() {
  const router = useRouter();
  const { payees, loading: payeesLoading } = usePayees();
  const { payments, loading: paymentsLoading, createPayment, cancelPayment, retryPayment, updatePayment, error: paymentError } = useBillPayments();
  const { accounts } = useAccounts();

  const [payeeId, setPayeeId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [cadence, setCadence] = useState<ScheduledPayment["cadence"]>("Monthly");
  const [deliverBy, setDeliverBy] = useState(new Date().toISOString().slice(0, 10));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPayeeId, setEditPayeeId] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editCadence, setEditCadence] = useState<ScheduledPayment["cadence"]>("Monthly");
  const [editDeliverBy, setEditDeliverBy] = useState(new Date().toISOString().slice(0, 10));

  const openAccounts = useMemo(() => accounts.filter((a) => a.status === "Open"), [accounts]);

  const startEdit = (payment: ScheduledPayment) => {
    setEditingId(payment.id);
    setEditPayeeId(payment.payeeId);
    setEditAmount(String(payment.amount));
    setEditCadence(payment.cadence);
    setEditDeliverBy(payment.deliverBy.slice(0, 10));
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    const parsedAmount = Number.parseFloat(editAmount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      Alert.alert("Error", "Enter a valid amount greater than 0");
      return;
    }
    if (!editPayeeId) {
      Alert.alert("Error", "Select a payee");
      return;
    }
    if (!CADENCE_OPTIONS.includes(editCadence)) {
      Alert.alert("Error", "Choose a valid cadence.");
      return;
    }
    try {
      await updatePayment(editingId, {
        payeeId: editPayeeId,
        amount: parsedAmount,
        cadence: editCadence,
        deliverBy: editDeliverBy,
      });
      setEditingId(null);
      Alert.alert("Saved", "Payment updated.");
    } catch (err) {
      Alert.alert("Error", err instanceof Error ? err.message : paymentError || "Failed to update payment");
    }
  };

  const handleSchedulePayment = async () => {
    if (!payeeId || !accountId || !amount) {
      Alert.alert("Error", "Please select a payee, an account, and enter an amount.");
      return;
    }

    const parsedAmount = Number.parseFloat(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      Alert.alert("Error", "Enter a valid amount greater than 0");
      return;
    }

    if (!CADENCE_OPTIONS.includes(cadence)) {
      Alert.alert("Error", "Choose a valid cadence.");
      return;
    }

    try {
      await createPayment(payeeId, accountId, parsedAmount, cadence, deliverBy);
      Alert.alert("Success", "Payment scheduled successfully");
      setAmount("");
    } catch (err) {
      Alert.alert("Error", err instanceof Error ? err.message : paymentError || "Failed to schedule payment");
    }
  };

  return (
    <Screen>
      <PageHeader
        title="Bill Pay"
        eyebrow="Scheduled payments"
        subtitle="Manage payees and schedule one-time or recurring bill payments."
      />
      <LinkButton label="Manage payees" onPress={() => router.push("/bill-pay/payees")} />

      {payeesLoading ? (
        <Card>
          <Text>Loading payees...</Text>
        </Card>
      ) : (
        <>
          <Modal transparent animationType="fade" visible={Boolean(editingId)} onRequestClose={() => setEditingId(null)}>
            <View style={{ flex: 1, justifyContent: "center", padding: 18, backgroundColor: "rgba(16, 35, 59, 0.45)" }}>
              <Pressable style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} onPress={() => setEditingId(null)} />
              <View style={{ backgroundColor: "#fff", borderRadius: 24, borderWidth: 1, borderColor: "rgba(177, 17, 31, 0.25)", padding: 18, gap: 10 }}>
                <Text style={{ fontSize: 20, fontWeight: "800" }}>Edit payment</Text>

                <Text style={{ fontWeight: "700" }}>Payee</Text>
                {payees.map((p) => (
                  <Row
                    key={p.id}
                    title={p.name}
                    subtitle={`${p.category} • ${p.accountMask}`}
                    right={p.id === editPayeeId ? <Text style={{ fontWeight: "800" }}>Selected</Text> : undefined}
                    onPress={() => setEditPayeeId(p.id)}
                  />
                ))}

                <Field label="Amount" value={editAmount} onChangeText={setEditAmount} placeholder="0.00" />
                <Text style={{ fontWeight: "700" }}>Cadence</Text>
                <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
                  {CADENCE_OPTIONS.map((option) => (
                    <View key={option} style={{ minWidth: 120 }}>
                      <Button
                        label={option}
                        variant={editCadence === option ? "primary" : "secondary"}
                        onPress={() => setEditCadence(option)}
                        disabled={paymentsLoading}
                      />
                    </View>
                  ))}
                </View>
                <Field label="Deliver by (YYYY-MM-DD)" value={editDeliverBy} onChangeText={setEditDeliverBy} />
                <Button label="Save changes" onPress={handleSaveEdit} disabled={paymentsLoading} />
                <Button label="Cancel" variant="secondary" onPress={() => setEditingId(null)} disabled={paymentsLoading} />
              </View>
            </View>
          </Modal>

          <Card>
            <Text style={{ fontWeight: "800", fontSize: 18 }}>Schedule payment</Text>
            <Text style={{ color: "#6B7280" }}>Tap a payee and source account to select.</Text>

            <Text style={{ fontWeight: "700" }}>Payee</Text>
            {payees.length === 0 ? (
              <Text>No payees yet. Add one first.</Text>
            ) : (
              payees.map((p) => (
                <Row
                  key={p.id}
                  title={p.name}
                  subtitle={`${p.category} • ${p.accountMask}`}
                  right={
                    p.id === payeeId ? (
                      <Ionicons name="checkmark-circle" size={20} color="#1f6b47" />
                    ) : (
                      <Ionicons name="chevron-forward" size={18} color="#6B7280" />
                    )
                  }
                  elevated
                  onPress={() => setPayeeId(p.id)}
                />
              ))
            )}

            <Text style={{ fontWeight: "700", marginTop: 6 }}>Pay from</Text>
            {openAccounts.length === 0 ? (
              <Text>No open accounts available.</Text>
            ) : (
              openAccounts.map((a) => (
                <Row
                  key={a.id}
                  title={a.nickname}
                  subtitle={`${a.type} ${a.maskedNumber} • Available ${formatCurrency(a.balances.availableBalance)}`}
                  right={
                    a.id === accountId ? (
                      <Ionicons name="checkmark-circle" size={20} color="#1f6b47" />
                    ) : (
                      <Ionicons name="chevron-forward" size={18} color="#6B7280" />
                    )
                  }
                  elevated
                  onPress={() => setAccountId(a.id)}
                />
              ))
            )}

            <Field label="Amount" value={amount} onChangeText={setAmount} placeholder="0.00" />

            <Text style={{ fontWeight: "700" }}>Cadence</Text>
            <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
              {CADENCE_OPTIONS.map((option) => (
                <View key={option} style={{ minWidth: 120 }}>
                  <Button
                    label={option}
                    variant={cadence === option ? "primary" : "secondary"}
                    onPress={() => setCadence(option)}
                    disabled={paymentsLoading}
                  />
                </View>
              ))}
            </View>

            <Field label="Deliver by (YYYY-MM-DD)" value={deliverBy} onChangeText={setDeliverBy} />
            <Button label={paymentsLoading ? "Scheduling..." : "Schedule payment"} onPress={handleSchedulePayment} disabled={paymentsLoading} />
          </Card>

          <Card>
            <Text style={{ fontWeight: "800", fontSize: 18 }}>Payments</Text>
            {payments.length === 0 ? (
              <Text>No scheduled payments yet.</Text>
            ) : (
              payments.map((payment) => (
                <Card key={payment.id} accent={payment.status === "FAILED"}>
                  <Row
                    title={payment.payeeName}
                    subtitle={`${formatDate(payment.deliverBy)} • ${payment.cadence}`}
                    right={
                      <View style={{ alignItems: "flex-end", gap: 6 }}>
                        <Text>{formatCurrency(payment.amount)}</Text>
                        <StatusChip status={payment.status} />
                      </View>
                    }
                  />
                  {payment.failureReason ? <Text style={{ color: "#6B7280" }}>{payment.failureReason}</Text> : null}
                  <Text style={{ color: "#6B7280" }}>
                    From: {accounts.find((a) => a.id === payment.accountId)?.nickname ?? payment.accountId}
                  </Text>
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    {payment.status !== "CANCELLED" ? (
                      <View style={{ flex: 1 }}>
                        <Button
                          label="Edit"
                          variant="secondary"
                          onPress={() => startEdit(payment)}
                        />
                      </View>
                    ) : null}
                    {(payment.status === "SCHEDULED" || payment.status === "FAILED") ? (
                      <View style={{ flex: 1 }}>
                        <Button
                          label="Cancel"
                          variant="secondary"
                          onPress={async () => {
                            try {
                              await cancelPayment(payment.id);
                            } catch (err) {
                              Alert.alert("Error", err instanceof Error ? err.message : paymentError || "Failed to cancel payment");
                            }
                          }}
                        />
                      </View>
                    ) : null}
                    {payment.status === "FAILED" ? (
                      <View style={{ flex: 1 }}>
                        <Button
                          label="Retry"
                          variant="secondary"
                          onPress={async () => {
                            try {
                              await retryPayment(payment.id);
                            } catch (err) {
                              Alert.alert("Error", err instanceof Error ? err.message : paymentError || "Failed to retry payment");
                            }
                          }}
                        />
                      </View>
                    ) : null}
                  </View>
                </Card>
              ))
            )}
          </Card>
        </>
      )}
    </Screen>
  );
}
