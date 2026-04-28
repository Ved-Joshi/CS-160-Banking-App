import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button, Card, Field, PageHeader, Row, Screen, SelectField } from "../../src/components/ui";
import { useAccounts, useExternalAccounts, useExternalTransfers, useMemberTransfers, useTransfers } from "../../src/lib/hooks";
import { localDateInputValue, pacificDateInputValue, utcDateInputValue } from "../../src/lib/format";
import { colors } from "../../src/theme/colors";
import type { TransferCadence, TransferScheduleMode, MemberTransferRecipient, ExternalAccountType } from "../../src/types";

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
  const {
    resolveRecipient,
    createTransfer: createMemberTransfer,
    fetchPlans: fetchMemberPlans,
    cancelPlan: cancelMemberPlan,
    retryPlan: retryMemberPlan,
    loading: memberLoading,
    resolving,
    error: memberError,
  } = useMemberTransfers();
  const {
    accounts: externalAccounts,
    loading: externalAccountsLoading,
    error: externalAccountsError,
    refresh: refreshExternalAccounts,
    create: createExternalAccount,
    createLinkSession,
    completeLink,
  } = useExternalAccounts();
  const { submit: submitExternalTransfer, loading: externalTransferLoading, error: externalTransferError } = useExternalTransfers();

  const [mode, setMode] = useState<"internal" | "member" | "external">("internal");
  const deviceTimezone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  }, []);
  const pacificToday = useMemo(() => pacificDateInputValue(), []);

  // Internal transfer state
  const [fromAccountId, setFromAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [transferDate] = useState(utcDateInputValue());
  const [submitted, setSubmitted] = useState(false);
  const [picking, setPicking] = useState<null | "from" | "to">(null);

  // Member transfer state
  const [memberFromAccountId, setMemberFromAccountId] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [recipient, setRecipient] = useState<MemberTransferRecipient | null>(null);
  const [memberAmount, setMemberAmount] = useState("");
  const [memberMemo, setMemberMemo] = useState("");
  const [scheduleMode, setScheduleMode] = useState<TransferScheduleMode>("NOW");
  const [memberTransferDate] = useState(utcDateInputValue());
  const [cadence, setCadence] = useState<TransferCadence>("Once");
  const [startDate, setStartDate] = useState(localDateInputValue());
  const [runTime, setRunTime] = useState("09:00");
  const [endDate, setEndDate] = useState("");
  const [memberSubmitted, setMemberSubmitted] = useState(false);
  const [memberPlans, setMemberPlans] = useState<any[]>([]);

  // External linking + transfer state
  const [externalSelectedAccountId, setExternalSelectedAccountId] = useState("");
  const [externalBankName, setExternalBankName] = useState("");
  const [externalNickname, setExternalNickname] = useState("");
  const [externalAccountType, setExternalAccountType] = useState<ExternalAccountType>("Checking");
  const [externalRoutingNumber, setExternalRoutingNumber] = useState("");
  const [externalAccountNumber, setExternalAccountNumber] = useState("");
  const [externalConfirmAccountNumber, setExternalConfirmAccountNumber] = useState("");
  const [externalLinkAccountId, setExternalLinkAccountId] = useState("");
  const [externalLinkSession, setExternalLinkSession] = useState<null | { sessionId: string; publishableKey: string; clientSecret: string }>(null);
  const [externalFromAccountId, setExternalFromAccountId] = useState("");
  const [externalAmount, setExternalAmount] = useState("");
  const [externalMemo, setExternalMemo] = useState("");
  const [externalScheduleMode, setExternalScheduleMode] = useState<TransferScheduleMode>("NOW");
  const [externalTransferDate, setExternalTransferDate] = useState(localDateInputValue());
  const [externalCadence, setExternalCadence] = useState<TransferCadence>("Once");
  const [externalStartDate, setExternalStartDate] = useState(localDateInputValue());
  const [externalRunTime, setExternalRunTime] = useState("09:00");
  const [externalEndDate, setExternalEndDate] = useState("");
  const [externalSubmitted, setExternalSubmitted] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);

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

  // Initialize external transfer from account
  useEffect(() => {
    if (accountsLoading) return;
    if (!externalFromAccountId || !checkingAccounts.some((account) => account.id === externalFromAccountId)) {
      setExternalFromAccountId(checkingAccounts[0]?.id ?? "");
    }
  }, [accountsLoading, checkingAccounts, externalFromAccountId]);

  useEffect(() => {
    if (!externalSelectedAccountId || !externalAccounts.some((account) => account.id === externalSelectedAccountId)) {
      setExternalSelectedAccountId(externalAccounts[0]?.id ?? "");
    }
  }, [externalAccounts, externalSelectedAccountId]);

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
          deviceTimezone
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

  const handleLoadMemberPlans = useCallback(async () => {
    try {
      const plans = await fetchMemberPlans();
      setMemberPlans(Array.isArray(plans) ? plans : []);
    } catch (err) {
      Alert.alert("Error", err instanceof Error ? err.message : memberError || "Failed to load transfer plans");
    }
  }, [fetchMemberPlans, memberError]);

  const onRefresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      await Promise.all([
        refreshAccounts(),
        refreshExternalAccounts(),
        memberPlans.length ? handleLoadMemberPlans() : Promise.resolve(),
      ]);
    } finally {
      setRefreshing(false);
      refreshingRef.current = false;
    }
  }, [handleLoadMemberPlans, memberPlans.length, refreshAccounts, refreshExternalAccounts]);

  const handleCancelMemberPlan = async (planId: string) => {
    try {
      await cancelMemberPlan(planId);
      await handleLoadMemberPlans();
      Alert.alert("Cancelled", "Scheduled member transfer cancelled.");
    } catch (err) {
      Alert.alert("Error", err instanceof Error ? err.message : memberError || "Failed to cancel plan");
    }
  };

  const handleRetryMemberPlan = async (planId: string) => {
    try {
      await retryMemberPlan(planId);
      await handleLoadMemberPlans();
      Alert.alert("Retried", "Scheduled member transfer retried.");
    } catch (err) {
      Alert.alert("Error", err instanceof Error ? err.message : memberError || "Failed to retry plan");
    }
  };

  const handleExternalManualLink = async () => {
    const payload = {
      bankName: externalBankName.trim(),
      nickname: externalNickname.trim() || externalBankName.trim(),
      accountType: externalAccountType,
      routingNumber: externalRoutingNumber.trim(),
      accountNumber: externalAccountNumber.trim(),
      confirmAccountNumber: externalConfirmAccountNumber.trim(),
    };

    if (
      payload.bankName.length < 2 ||
      payload.nickname.length < 2 ||
      payload.routingNumber.length !== 9 ||
      payload.accountNumber.length < 4 ||
      payload.accountNumber !== payload.confirmAccountNumber
    ) {
      Alert.alert("Check details", "Enter bank name, routing number (9 digits), and matching account numbers.");
      return;
    }

    try {
      const created = await createExternalAccount(payload);
      setExternalSelectedAccountId(created.id);
      setExternalBankName("");
      setExternalNickname("");
      setExternalRoutingNumber("");
      setExternalAccountNumber("");
      setExternalConfirmAccountNumber("");
      Alert.alert("Linked", "External bank account linked.");
    } catch (err) {
      Alert.alert("Error", err instanceof Error ? err.message : externalAccountsError || "Failed to link account");
    }
  };

  const handleStartStripeSandboxLink = async () => {
    try {
      const session = await createLinkSession();
      setExternalLinkSession(session);
      Alert.alert(
        "Link session created",
        "Stripe sandbox linking UI is not embedded on mobile yet. If you have a Stripe financial connections account id, paste it below and complete link."
      );
    } catch (err) {
      Alert.alert("Error", err instanceof Error ? err.message : externalAccountsError || "Failed to start link session");
    }
  };

  const handleCompleteStripeSandboxLink = async () => {
    const id = externalLinkAccountId.trim();
    if (!id) {
      Alert.alert("Missing account id", "Paste the linked account id to complete.");
      return;
    }
    try {
      const created = await completeLink(id);
      setExternalSelectedAccountId(created.id);
      setExternalLinkAccountId("");
      Alert.alert("Linked", "External account linked.");
    } catch (err) {
      Alert.alert("Error", err instanceof Error ? err.message : externalAccountsError || "Failed to complete link");
    }
  };

  const handleExternalSubmit = async () => {
    if (!externalFromAccountId || !externalSelectedAccountId || !externalAmount) {
      Alert.alert("Missing info", "Select a funding account, external account, and amount.");
      return;
    }
    const parsedAmount = Number(externalAmount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      Alert.alert("Error", "Enter a valid transfer amount.");
      return;
    }
    try {
      if (externalScheduleMode === "NOW") {
        await submitExternalTransfer({
          fromAccountId: externalFromAccountId,
          externalAccountId: externalSelectedAccountId,
          amount: parsedAmount,
          memo: externalMemo || undefined,
          scheduleMode: "NOW",
          transferDate: externalTransferDate,
        });
      } else {
        await submitExternalTransfer({
          fromAccountId: externalFromAccountId,
          externalAccountId: externalSelectedAccountId,
          amount: parsedAmount,
          memo: externalMemo || undefined,
          scheduleMode: "SCHEDULED",
          cadence: externalCadence,
          startDate: externalStartDate,
          runTime: externalRunTime,
          endDate: externalEndDate || undefined,
          timezone: deviceTimezone,
        });
      }
      Alert.alert("Success", "External transfer submitted");
      setExternalSubmitted(true);
      setExternalAmount("");
      setExternalMemo("");
      await refreshAccounts();
      await refreshExternalAccounts();
    } catch (err) {
      Alert.alert("Error", err instanceof Error ? err.message : externalTransferError || "Failed to submit external transfer");
    }
  };

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
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
                    <View
                      style={{
                        borderWidth: 1,
                        borderColor: colors.line,
                        borderRadius: 16,
                        paddingHorizontal: 14,
                        paddingVertical: 12,
                        backgroundColor: colors.white,
                        gap: 4,
                      }}
                    >
                      <Text style={{ fontWeight: "700", color: colors.text }}>Transfer date</Text>
                      <Text style={{ color: colors.text, fontSize: 16 }}>{pacificToday}</Text>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>
                        Internal transfers are processed on the same day only. Displayed in Pacific Time.
                      </Text>
                    </View>
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
                    <Text>Date: {pacificToday}</Text>
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
                      <View
                        style={{
                          borderWidth: 1,
                          borderColor: colors.line,
                          borderRadius: 16,
                          paddingHorizontal: 14,
                          paddingVertical: 12,
                          backgroundColor: colors.white,
                          gap: 4,
                        }}
                      >
                        <Text style={{ fontWeight: "700", color: colors.text }}>Transfer date</Text>
                        <Text style={{ color: colors.text, fontSize: 16 }}>{pacificToday}</Text>
                        <Text style={{ color: colors.muted, fontSize: 12 }}>
                          Immediate member transfers are processed on the same day only. Displayed in Pacific Time.
                        </Text>
                      </View>
                    ) : (
                      <>
                        <Text style={{ marginTop: 12, fontWeight: "600", color: colors.text }}>Recurring schedule</Text>
                        <SelectField
                          label="Cadence"
                          value={cadence}
                          options={CADENCE_OPTIONS.map((option) => ({ label: option, value: option }))}
                          onChange={(value) => {
                            if (value) setCadence(value);
                          }}
                        />
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
                      <Text>Date: {pacificToday}</Text>
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
            <>
              {!checkingAccounts.length ? (
                <Card>
                  <Text style={{ fontWeight: "800" }}>Checking account required</Text>
                  <Text>Open a checking account before making external transfers.</Text>
                </Card>
              ) : (
                <ScrollView>
                  <Card>
                    <Text style={{ fontWeight: "800", fontSize: 18 }}>Linked external accounts</Text>
                    <Text style={{ color: colors.muted }}>
                      Link an external bank (manual entry), then transfer from your checking account.
                    </Text>
                    <Button
                      label={externalAccountsLoading ? "Refreshing..." : "Refresh linked accounts"}
                      variant="secondary"
                      onPress={refreshExternalAccounts}
                      disabled={externalAccountsLoading}
                    />
                    {externalAccountsError ? <Text style={{ color: colors.red700 }}>{externalAccountsError}</Text> : null}
                    {externalAccountsLoading ? (
                      <Text>Loading external accounts...</Text>
                    ) : externalAccounts.length === 0 ? (
                      <Text>No linked accounts yet.</Text>
                    ) : (
                      externalAccounts.map((account) => (
                        <Row
                          key={account.id}
                          title={account.nickname || account.bankName}
                          subtitle={`${account.bankName} ${account.maskedAccountNumber} • ${account.accountType} • ${account.verificationStatus}`}
                          right={
                            account.id === externalSelectedAccountId ? (
                              <Text style={{ color: colors.text, fontWeight: "800" }}>Selected</Text>
                            ) : undefined
                          }
                          onPress={() => setExternalSelectedAccountId(account.id)}
                        />
                      ))
                    )}
                  </Card>

                  <Card>
                    <Text style={{ fontWeight: "800", fontSize: 18 }}>Link external bank (manual)</Text>
                    <Field label="Bank name" value={externalBankName} onChangeText={setExternalBankName} placeholder="Example Bank" />
                    <Field label="Nickname" value={externalNickname} onChangeText={setExternalNickname} placeholder="My checking" />
                    <View style={{ flexDirection: "row", gap: 10 }}>
                      <View style={{ flex: 1 }}>
                        <Button
                          label="Checking"
                          variant={externalAccountType === "Checking" ? "primary" : "secondary"}
                          onPress={() => setExternalAccountType("Checking")}
                          disabled={externalAccountsLoading}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Button
                          label="Savings"
                          variant={externalAccountType === "Savings" ? "primary" : "secondary"}
                          onPress={() => setExternalAccountType("Savings")}
                          disabled={externalAccountsLoading}
                        />
                      </View>
                    </View>
                    <Field label="Routing number (9 digits)" value={externalRoutingNumber} onChangeText={setExternalRoutingNumber} placeholder="000000000" />
                    <Field label="Account number" value={externalAccountNumber} onChangeText={setExternalAccountNumber} placeholder="123456789" />
                    <Field label="Confirm account number" value={externalConfirmAccountNumber} onChangeText={setExternalConfirmAccountNumber} placeholder="123456789" />
                    <Button label="Link account" onPress={handleExternalManualLink} disabled={externalAccountsLoading} />
                    <Text style={{ color: colors.muted, fontSize: 12 }}>
                      Note: This is a sandbox/manual link. Full Stripe Financial Connections UI is web-only right now.
                    </Text>
                  </Card>

                  <Card>
                    <Text style={{ fontWeight: "800", fontSize: 18 }}>Stripe sandbox link (optional)</Text>
                    <Button label="Create link session" variant="secondary" onPress={handleStartStripeSandboxLink} disabled={externalAccountsLoading} />
                    {externalLinkSession ? (
                      <>
                        <Text style={{ color: colors.muted, fontSize: 12 }}>Session: {externalLinkSession.sessionId}</Text>
                        <Field
                          label="Complete with account id"
                          value={externalLinkAccountId}
                          onChangeText={setExternalLinkAccountId}
                          placeholder="fa_..."
                        />
                        <Button label="Complete link" onPress={handleCompleteStripeSandboxLink} disabled={externalAccountsLoading} />
                      </>
                    ) : null}
                  </Card>

                  <Card>
                    <Text style={{ fontWeight: "800", fontSize: 18 }}>External transfer</Text>
                    <Text style={{ color: colors.muted }}>
                      Funding account must be checking. External accounts must be linked and verified.
                    </Text>

                    <Text style={{ marginTop: 10, fontWeight: "700" }}>From (checking)</Text>
                    {checkingAccounts.map((account) => (
                      <Row
                        key={account.id}
                        title={account.nickname}
                        subtitle={`${account.type} • ${account.maskedNumber}`}
                        right={account.id === externalFromAccountId ? <Text style={{ fontWeight: "800" }}>Selected</Text> : undefined}
                        onPress={() => setExternalFromAccountId(account.id)}
                      />
                    ))}

                    <Text style={{ marginTop: 10, fontWeight: "700" }}>To (external)</Text>
                    {externalAccounts.length === 0 ? (
                      <Text>Link an external account above first.</Text>
                    ) : (
                      externalAccounts.map((account) => (
                        <Row
                          key={account.id}
                          title={account.nickname || account.bankName}
                          subtitle={`${account.bankName} ${account.maskedAccountNumber}`}
                          right={account.id === externalSelectedAccountId ? <Text style={{ fontWeight: "800" }}>Selected</Text> : undefined}
                          onPress={() => setExternalSelectedAccountId(account.id)}
                        />
                      ))
                    )}

                    <Field label="Amount" value={externalAmount} onChangeText={setExternalAmount} placeholder="0.00" />
                    <Field label="Memo (optional)" value={externalMemo} onChangeText={setExternalMemo} placeholder="Note" />

                    <Text style={{ marginTop: 10, fontWeight: "700" }}>Schedule</Text>
                    <Button
                      label="Now"
                      variant={externalScheduleMode === "NOW" ? "primary" : "secondary"}
                      onPress={() => setExternalScheduleMode("NOW")}
                    />
                    <Button
                      label="Scheduled"
                      variant={externalScheduleMode === "SCHEDULED" ? "primary" : "secondary"}
                      onPress={() => setExternalScheduleMode("SCHEDULED")}
                    />

                    {externalScheduleMode === "NOW" ? (
                      <Field label="Transfer date" value={externalTransferDate} onChangeText={setExternalTransferDate} />
                    ) : (
                      <>
                        <Text style={{ marginTop: 12, fontWeight: "600", color: colors.text }}>Recurring schedule</Text>
                        <SelectField
                          label="Cadence"
                          value={externalCadence}
                          options={CADENCE_OPTIONS.map((option) => ({ label: option, value: option }))}
                          onChange={(value) => {
                            if (value) setExternalCadence(value);
                          }}
                        />
                        <Field label="Start date" value={externalStartDate} onChangeText={setExternalStartDate} />
                        <Field label="Run time (HH:MM)" value={externalRunTime} onChangeText={setExternalRunTime} placeholder="09:00" />
                        <Field label="End date (optional)" value={externalEndDate} onChangeText={setExternalEndDate} />
                        <Text style={{ color: colors.muted, fontSize: 12 }}>Timezone: {deviceTimezone}</Text>
                      </>
                    )}

                    <Button
                      label={externalTransferLoading ? "Submitting..." : "Submit external transfer"}
                      onPress={handleExternalSubmit}
                      disabled={externalTransferLoading || !externalFromAccountId || !externalSelectedAccountId || !externalAmount}
                    />
                    {externalTransferError ? <Text style={{ color: colors.red700 }}>{externalTransferError}</Text> : null}
                  </Card>

                  <Card>
                    <Text style={{ fontWeight: "800", fontSize: 18 }}>Transfer review</Text>
                    <Text>From: {checkingAccounts.find((a) => a.id === externalFromAccountId)?.nickname || "Select checking account"}</Text>
                    <Text>To: {externalAccounts.find((a) => a.id === externalSelectedAccountId)?.nickname || "Select external account"}</Text>
                    <Text>Amount: {externalAmount || "0.00"}</Text>
                    {externalScheduleMode === "NOW" ? (
                      <Text>Date: {externalTransferDate}</Text>
                    ) : (
                      <>
                        <Text>Cadence: {externalCadence}</Text>
                        <Text>Start: {externalStartDate}</Text>
                        {externalEndDate && <Text>End: {externalEndDate}</Text>}
                      </>
                    )}
                    {externalSubmitted ? (
                      <Text style={{ fontWeight: "700" }}>Transfer submitted.</Text>
                    ) : (
                      <Text>Fill out the form to review before submitting.</Text>
                    )}
                  </Card>
                  <Card>
                    <Text style={{ fontWeight: "800", fontSize: 18 }}>Scheduled member transfers</Text>
                    <Button
                      label={memberLoading ? "Loading..." : "Load scheduled plans"}
                      variant="secondary"
                      onPress={handleLoadMemberPlans}
                      disabled={memberLoading}
                    />
                    {memberPlans.length === 0 ? (
                      <Text style={{ color: colors.muted }}>No scheduled plans loaded.</Text>
                    ) : (
                      memberPlans.map((plan) => (
                        <Card key={plan.id} accent>
                          <Text style={{ fontWeight: "800" }}>{plan.recipientDisplayName || "Member transfer plan"}</Text>
                          <Text style={{ color: colors.muted }}>
                            {plan.cadence} • {plan.amount} • {plan.status}
                          </Text>
                          <Text style={{ color: colors.muted }}>
                            Next: {plan.nextRunAt || "—"} • Start: {plan.startDate} • Time: {plan.runTime}
                          </Text>
                          <View style={{ flexDirection: "row", gap: 10 }}>
                            <View style={{ flex: 1 }}>
                              <Button
                                label="Cancel"
                                variant="secondary"
                                onPress={() => handleCancelMemberPlan(plan.id)}
                                disabled={memberLoading}
                              />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Button
                                label="Retry"
                                variant="secondary"
                                onPress={() => handleRetryMemberPlan(plan.id)}
                                disabled={memberLoading}
                              />
                            </View>
                          </View>
                        </Card>
                      ))
                    )}
                  </Card>
                </ScrollView>
              )}
            </>
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
