import { useEffect, useMemo, useState } from "react";
import { Alert, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Button, Card, Field, PageHeader, Row, Screen } from "../../src/components/ui";
import { useAccounts, useTransfers } from "../../src/lib/hooks";
import { colors } from "../../src/theme/colors";

function AccountPickerModal({
  visible,
  title,
  subtitle,
  accounts,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  accounts: Array<{ id: string; nickname: string; maskedNumber: string; type: string }>;
  onSelect: (accountId: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <View style={stylesModal.backdrop}>
        <Pressable style={stylesModal.backdropPressable} onPress={onClose} />
        <View style={stylesModal.sheet}>
          <Text style={stylesModal.title}>{title}</Text>
          {subtitle ? <Text style={stylesModal.subtitle}>{subtitle}</Text> : null}

          <View style={stylesModal.list}>
            {accounts.map((account) => (
              <Pressable
                key={account.id}
                onPress={() => onSelect(account.id)}
                style={({ pressed }) => [stylesModal.item, pressed && stylesModal.itemPressed]}
              >
                <Text style={stylesModal.itemTitle}>{account.nickname}</Text>
                <Text style={stylesModal.itemSubtitle}>
                  {account.type} • {account.maskedNumber}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={{ marginTop: 8 }}>
            <Button label="Cancel" variant="secondary" onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default function TransfersScreen() {
  const { accounts, loading: accountsLoading, refresh: refreshAccounts } = useAccounts();
  const { createTransfer, loading: transferLoading, error: transferError } = useTransfers();

  const [mode, setMode] = useState<"internal" | "external">("internal");
  const [fromAccountId, setFromAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [transferDate, setTransferDate] = useState(new Date().toISOString().slice(0, 10));
  const [submitted, setSubmitted] = useState(false);
  const [picking, setPicking] = useState<null | "from" | "to">(null);

  const openAccounts = useMemo(() => accounts.filter((account) => account.status === "Open"), [accounts]);
  const checkingAccounts = useMemo(
    () => openAccounts.filter((account) => account.type === "Checking"),
    [openAccounts]
  );
  const toAccountOptions = useMemo(
    () => openAccounts.filter((account) => account.id !== fromAccountId),
    [fromAccountId, openAccounts]
  );
  const fromAccount = useMemo(
    () => checkingAccounts.find((account) => account.id === fromAccountId) ?? null,
    [checkingAccounts, fromAccountId]
  );
  const toAccount = useMemo(
    () => openAccounts.find((account) => account.id === toAccountId) ?? null,
    [openAccounts, toAccountId]
  );

  useEffect(() => {
    if (accountsLoading) return;

    if (!fromAccountId || !checkingAccounts.some((account) => account.id === fromAccountId)) {
      setFromAccountId(checkingAccounts[0]?.id ?? "");
    }
  }, [accountsLoading, checkingAccounts, fromAccountId]);

  useEffect(() => {
    if (accountsLoading) return;
    if (!fromAccountId) return;

    if (!toAccountId || !toAccountOptions.some((account) => account.id === toAccountId)) {
      setToAccountId(toAccountOptions[0]?.id ?? "");
    }
  }, [accountsLoading, fromAccountId, toAccountId, toAccountOptions]);

  const handleSubmit = async () => {
    if (mode !== "internal") return;

    if (!fromAccountId || !toAccountId || !amount) {
      Alert.alert("Error", "Please fill in all required fields");
      return;
    }

    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      Alert.alert("Error", "Enter a valid transfer amount.");
      return;
    }

    if (fromAccountId === toAccountId) {
      Alert.alert("Error", "Choose two different accounts.");
      return;
    }

    if (!fromAccount) {
      Alert.alert("Error", "Internal transfers must be funded from a checking account.");
      return;
    }

    try {
      await createTransfer(fromAccountId, toAccountId, parsedAmount, memo, transferDate);
      Alert.alert("Success", "Transfer submitted successfully");
      setSubmitted(true);
      setAmount("");
      setMemo("");
      await refreshAccounts();
    } catch (err) {
      Alert.alert("Error", err instanceof Error ? err.message : transferError || "Failed to submit transfer");
    }
  };

  return (
    <Screen>
      <PageHeader title="Transfers" eyebrow="Move money" subtitle="Transfer between your accounts or to an external bank." />
      {accountsLoading ? (
        <Card>
          <Text>Loading accounts...</Text>
        </Card>
      ) : (
        <>
          <Card>
            <Text style={{ fontWeight: "800", fontSize: 18 }}>Transfer type</Text>
            <Text style={{ color: colors.muted }}>
              Choose where you want to send money. Tap a button below to switch modes.
            </Text>
            <Button
              label="My accounts"
              variant={mode === "internal" ? "primary" : "secondary"}
              onPress={() => setMode("internal")}
            />
            <Button
              label="External bank"
              variant={mode === "external" ? "primary" : "secondary"}
              onPress={() => setMode("external")}
            />
          </Card>

          {mode === "internal" ? (
            <>
              {!checkingAccounts.length ? (
                <Card>
                  <Text style={{ fontWeight: "800" }}>Checking account required</Text>
                  <Text>Open a checking account before making internal transfers.</Text>
                </Card>
              ) : (
                <>
                  <Card>
                    <Text style={{ fontWeight: "800", fontSize: 18 }}>Internal transfer</Text>
                    <Text style={{ color: colors.muted }}>
                      Step 1: Tap the rows below to pick accounts. Step 2: Enter an amount. Step 3: Press “Submit transfer”.
                    </Text>
                    <Row
                      title="From (checking)"
                      subtitle={fromAccount ? `${fromAccount.nickname} (${fromAccount.maskedNumber})` : "Select checking account"}
                      right={<Text style={{ color: colors.linkBlue, fontWeight: "800" }}>Change</Text>}
                      onPress={() => setPicking("from")}
                    />
                    <Row
                      title="To"
                      subtitle={toAccount ? `${toAccount.nickname} (${toAccount.maskedNumber})` : "Select destination account"}
                      right={<Text style={{ color: colors.linkBlue, fontWeight: "800" }}>Change</Text>}
                      onPress={() => setPicking("to")}
                    />
                  <Field label="Amount" value={amount} onChangeText={setAmount} />
                  <Field label="Memo" value={memo} onChangeText={setMemo} />
                  <Field label="Transfer date" value={transferDate} onChangeText={setTransferDate} />
                  <Button label="Submit transfer" onPress={handleSubmit} disabled={transferLoading || !fromAccountId || !toAccountId} />
                </Card>

                  <Card>
                    <Text style={{ fontWeight: "800", fontSize: 18 }}>Transfer review</Text>
                    <Text>From: {fromAccount?.nickname || "Select account"}</Text>
                    <Text>To: {toAccount?.nickname || "Select account"}</Text>
                    <Text>Amount: {amount || "0.00"}</Text>
                    <Text>Date: {transferDate}</Text>
                    {submitted ? <Text style={{ fontWeight: "700" }}>Transfer submitted.</Text> : <Text>Fill out the form to review before submitting.</Text>}
                  </Card>
                </>
              )}
            </>
          ) : (
            <Card>
              <Text style={{ fontWeight: "800", fontSize: 18 }}>External transfers</Text>
              <Text>External bank transfers are supported on the web app, but not implemented on mobile yet.</Text>
            </Card>
          )}

          <AccountPickerModal
            visible={Boolean(picking)}
            title={picking === "from" ? "Choose funding account" : "Choose destination account"}
            subtitle="Tap an account to select it."
            accounts={(picking === "from" ? checkingAccounts : toAccountOptions).map((account) => ({
              id: account.id,
              nickname: account.nickname,
              maskedNumber: account.maskedNumber,
              type: account.type,
            }))}
            onClose={() => setPicking(null)}
            onSelect={(accountId) => {
              if (picking === "from") setFromAccountId(accountId);
              else setToAccountId(accountId);
              setPicking(null);
            }}
          />
        </>
      )}
    </Screen>
  );
}

const stylesModal = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "center",
    padding: 18,
    backgroundColor: "rgba(16, 35, 59, 0.45)",
  },
  backdropPressable: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    backgroundColor: colors.white,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(177, 17, 31, 0.25)",
    padding: 18,
    gap: 10,
  },
  title: { fontSize: 20, fontWeight: "800", color: colors.text },
  subtitle: { color: colors.muted, fontWeight: "600" },
  list: { gap: 6, marginTop: 6 },
  item: {
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
  },
  itemPressed: { backgroundColor: "rgba(16,35,59,0.05)" },
  itemTitle: { color: colors.text, fontWeight: "800", fontSize: 16 },
  itemSubtitle: { color: colors.muted, marginTop: 4, fontWeight: "600" },
});
