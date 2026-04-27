import { useEffect, useMemo, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button, Card, Field, PageHeader, Row, Screen } from "../../src/components/ui";
import { useAccounts, useTransfers, useMemberTransfers } from "../../src/lib/hooks";
import { colors } from "../../src/theme/colors";
import type { TransferCadence, TransferScheduleMode, MemberTransferRecipient } from "../../src/types";

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

const CADENCE_OPTIONS: TransferCadence[] = ["Once", "Daily", "Weekly", "Biweekly", "Monthly"];

export default function TransfersScreen() {
  const { accounts, loading: accountsLoading, refresh: refreshAccounts } = useAccounts();
  const { createTransfer, loading: transferLoading, error: transferError } = useTransfers();
  const { resolveRecipient, createTransfer: createMemberTransfer, loading: memberLoading, resolving, error: memberError } = useMemberTransfers();

  const [mode, setMode] = useState<"internal" | "member" | "external">("internal");

  // Internal transfer state
  const [fromAccountId, setFromAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [transferDate, setTransferDate] = useState(new Date().toISOString().slice(0, 10));
  const [submitted, setSubmitted] = useState(false);
  const [picking, setPicking] = useState<null | "from" | "to">(null);

  // Member transfer state
  const [memberFromAccountId, setMemberFromAccountId] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [recipient, setRecipient] = useState<MemberTransferRecipient | null>(null);
  const [memberAmount, setMemberAmount] = useState("");
  const [memberMemo, setMemberMemo] = useState("");
  const [scheduleMode, setScheduleMode] = useState<TransferScheduleMode>("NOW");
  const [memberTransferDate, setMemberTransferDate] = useState(new Date().toISOString().slice(0, 10));
  const [cadence, setCadence] = useState<TransferCadence>("Once");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [runTime, setRunTime] = useState("09:00");
  const [endDate, setEndDate] = useState("");
  const [memberSubmitted, setMemberSubmitted] = useState(false);

  const openAccounts = useMemo(() => accounts.filter((account) => account.status === "Open"), [accounts]);
  const checkingAccounts = useMemo(
    () => openAccounts.filter((account) => account.type === "Checking"),
    [openAccounts]
  );

  // Internal transfer memos
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

  // Member transfer memos
  const memberFromAccount = useMemo(
    () => checkingAccounts.find((account) => account.id === memberFromAccountId) ?? null,
    [checkingAccounts, memberFromAccountId]
  );

  // Initialize internal transfer from account
  useEffect(() => {
    if (accountsLoading) return;

    if (!fromAccountId || !checkingAccounts.some((account) => account.id === fromAccountId)) {
      setFromAccountId(checkingAccounts[0]?.id ?? "");
    }
  }, [accountsLoading, checkingAccounts, fromAccountId]);

  // Initialize internal transfer to account
  useEffect(() => {
    if (accountsLoading) return;
    if (!fromAccountId) return;

    if (!toAccountId || !toAccountOptions.some((account) => account.id === toAccountId)) {
      setToAccountId(toAccountOptions[0]?.id ?? "");
    }
  }, [accountsLoading, fromAccountId, toAccountId, toAccountOptions]);

  // Initialize member transfer from account
  useEffect(() => {
    if (accountsLoading) return;

    if (!memberFromAccountId || !checkingAccounts.some((account) => account.id === memberFromAccountId)) {
      setMemberFromAccountId(checkingAccounts[0]?.id ?? "");
    }
  }, [accountsLoading, checkingAccounts, memberFromAccountId]);

  const handleResolveRecipient = async () => {
    if (!recipientEmail.trim()) {
      Alert.alert("Error", "Please enter a recipient email");
      return;
    }

    try {
      const resolvedRecipient = await resolveRecipient(recipientEmail);
      setRecipient(resolvedRecipient);
      Alert.alert("Success", `Found ${resolvedRecipient.displayName}`);
    } catch (err) {
      Alert.alert("Error", err instanceof Error ? err.message : "Failed to resolve recipient");
    }
  };

  const handleInternalSubmit = async () => {
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

  const handleMemberSubmit = async () => {
    if (!memberFromAccountId || !recipient || !memberAmount) {
      Alert.alert("Error", "Please fill in all required fields and resolve recipient");
      return;
    }

    const parsedAmount = Number(memberAmount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      Alert.alert("Error", "Enter a valid transfer amount.");
      return;
    }

    try {
      if (scheduleMode === "NOW") {
        await createMemberTransfer(
          memberFromAccountId,
          recipientEmail,
          parsedAmount,
          memberMemo,
          "NOW",
          memberTransferDate
        );
      } else {
        await createMemberTransfer(
          memberFromAccountId,
          recipientEmail,
          parsedAmount,
          memberMemo,
          "SCHEDULED",
          undefined,
          cadence,
          startDate,
          runTime,
          endDate,
          undefined
        );
      }
      Alert.alert("Success", "Member transfer submitted successfully");
      setMemberSubmitted(true);
      setRecipientEmail("");
      setRecipient(null);
      setMemberAmount("");
      setMemberMemo("");
      await refreshAccounts();
    } catch (err) {
      Alert.alert("Error", err instanceof Error ? err.message : memberError || "Failed to submit member transfer");
    }
  };

  return (
    <Screen>
      <PageHeader
        title="Transfers"
        eyebrow="Move money"
        subtitle="Transfer between your accounts, to members, or external banks."
      />
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
              label="Member"
              variant={mode === "member" ? "primary" : "secondary"}
              onPress={() => setMode("member")}
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
                <ScrollView>
                  <Card>
                    <Text style={{ fontWeight: "800", fontSize: 18 }}>Internal transfer</Text>
                    <Text style={{ color: colors.muted }}>
                      Step 1: Tap the rows below to pick accounts. Step 2: Enter an amount. Step 3: Press "Submit transfer".
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
                    <Button
                      label="Submit transfer"
                      onPress={handleInternalSubmit}
                      disabled={transferLoading || !fromAccountId || !toAccountId}
                    />
                  </Card>

                  <Card>
                    <Text style={{ fontWeight: "800", fontSize: 18 }}>Transfer review</Text>
                    <Text>From: {fromAccount?.nickname || "Select account"}</Text>
                    <Text>To: {toAccount?.nickname || "Select account"}</Text>
                    <Text>Amount: {amount || "0.00"}</Text>
                    <Text>Date: {transferDate}</Text>
                    {submitted ? (
                      <Text style={{ fontWeight: "700" }}>Transfer submitted.</Text>
                    ) : (
                      <Text>Fill out the form to review before submitting.</Text>
                    )}
                  </Card>
                </ScrollView>
              )}
            </>
          ) : mode === "member" ? (
            <>
              {!checkingAccounts.length ? (
                <Card>
                  <Text style={{ fontWeight: "800" }}>Checking account required</Text>
                  <Text>Open a checking account before making member transfers.</Text>
                </Card>
              ) : (
                <ScrollView>
                  <Card>
                    <Text style={{ fontWeight: "800", fontSize: 18 }}>Member transfer</Text>
                    <Text style={{ color: colors.muted }}>
                      Transfer money to another bank member. Enter their email and resolve to find them.
                    </Text>
                    <Row
                      title="From (checking)"
                      subtitle={memberFromAccount ? `${memberFromAccount.nickname} (${memberFromAccount.maskedNumber})` : "Select checking account"}
                      right={<Text style={{ color: colors.linkBlue, fontWeight: "800" }}>Change</Text>}
                      onPress={() => setPicking("from")}
                    />
                    <Field
                      label="Recipient email"
                      value={recipientEmail}
                      onChangeText={setRecipientEmail}
                      placeholder="example@email.com"
                    />
                    <Button
                      label={resolving ? "Resolving..." : "Resolve recipient"}
                      onPress={handleResolveRecipient}
                      disabled={resolving || transferLoading}
                    />
                    {recipient && (
                      <View style={{ marginTop: 12, padding: 12, backgroundColor: "rgba(76, 175, 80, 0.1)", borderRadius: 8 }}>
                        <Text style={{ fontWeight: "800", color: colors.text }}>
                          {recipient.displayName}
                        </Text>
                        <Text style={{ color: colors.muted, fontSize: 12 }}>
                          {recipient.email}
                        </Text>
                        <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>
                          Default account: {recipient.defaultCheckingAccountMasked}
                        </Text>
                      </View>
                    )}
                  </Card>

                  <Card>
                    <Text style={{ fontWeight: "800", fontSize: 18 }}>Transfer details</Text>
                    <Field label="Amount" value={memberAmount} onChangeText={setMemberAmount} />
                    <Field label="Memo" value={memberMemo} onChangeText={setMemberMemo} />
                  </Card>

                  <Card>
                    <Text style={{ fontWeight: "800", fontSize: 18 }}>Schedule</Text>
                    <Text style={{ color: colors.muted }}>
                      Choose whether to transfer now or schedule for later.
                    </Text>
                    <Button
                      label="Now"
                      variant={scheduleMode === "NOW" ? "primary" : "secondary"}
                      onPress={() => setScheduleMode("NOW")}
                    />
                    <Button
                      label="Scheduled"
                      variant={scheduleMode === "SCHEDULED" ? "primary" : "secondary"}
                      onPress={() => setScheduleMode("SCHEDULED")}
                    />

                    {scheduleMode === "NOW" ? (
                      <Field label="Transfer date" value={memberTransferDate} onChangeText={setMemberTransferDate} />
                    ) : (
                      <>
                        <Text style={{ marginTop: 12, fontWeight: "600", color: colors.text }}>Recurring schedule</Text>
                        <Field label="Cadence" value={cadence} onChangeText={(val) => setCadence(val as TransferCadence)} />
                        <Field label="Start date" value={startDate} onChangeText={setStartDate} />
                        <Field label="Run time (HH:MM)" value={runTime} onChangeText={setRunTime} placeholder="09:00" />
                        <Field label="End date (optional)" value={endDate} onChangeText={setEndDate} />
                      </>
                    )}
                  </Card>

                  <Card>
                    <Button
                      label="Submit transfer"
                      onPress={handleMemberSubmit}
                      disabled={memberLoading || !memberFromAccountId || !recipient || !memberAmount}
                    />
                  </Card>

                  <Card>
                    <Text style={{ fontWeight: "800", fontSize: 18 }}>Transfer review</Text>
                    <Text>From: {memberFromAccount?.nickname || "Select account"}</Text>
                    <Text>To: {recipient?.displayName || "Resolve recipient"}</Text>
                    <Text>Amount: {memberAmount || "0.00"}</Text>
                    {scheduleMode === "NOW" ? (
                      <Text>Date: {memberTransferDate}</Text>
                    ) : (
                      <>
                        <Text>Cadence: {cadence}</Text>
                        <Text>Start: {startDate}</Text>
                        {endDate && <Text>End: {endDate}</Text>}
                      </>
                    )}
                    {memberSubmitted ? (
                      <Text style={{ fontWeight: "700" }}>Transfer submitted.</Text>
                    ) : (
                      <Text>Fill out the form to review before submitting.</Text>
                    )}
                  </Card>
                </ScrollView>
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
              if (mode === "internal") {
                if (picking === "from") setFromAccountId(accountId);
                else setToAccountId(accountId);
              } else if (mode === "member") {
                if (picking === "from") setMemberFromAccountId(accountId);
              }
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
