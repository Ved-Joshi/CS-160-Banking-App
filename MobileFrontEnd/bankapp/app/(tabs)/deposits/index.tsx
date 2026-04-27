import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Text, View } from "react-native";
import { Button, Card, Field, PageHeader, Row, Screen, StatusChip } from "../../../src/components/ui";
import { formatCurrency, formatDateTime } from "../../../src/lib/format";
import { useAccounts, useAtmWithdrawals, useDeposits } from "../../../src/lib/hooks";
import * as api from "../../../src/lib/api";
import * as FileSystem from "expo-file-system/legacy";

function guessContentType(fileName: string): string {
  const normalized = fileName.trim().toLowerCase();
  if (normalized.endsWith(".png")) return "image/png";
  if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg")) return "image/jpeg";
  if (normalized.endsWith(".webp")) return "image/webp";
  if (normalized.endsWith(".heic")) return "image/heic";
  if (normalized.endsWith(".heif")) return "image/heif";
  return "application/octet-stream";
}

function fileNameFromUri(uri: string, fallback: string): string {
  const path = uri.split("?")[0] ?? "";
  const last = path.split("/").pop();
  const cleaned = (last ? decodeURIComponent(last) : "").trim();
  return cleaned || fallback;
}

async function getUploadMeta(uri: string, fallbackFileName: string) {
  const info = await FileSystem.getInfoAsync(uri, { size: true });
  if (!info.exists) throw new Error("Image file was not found on device.");
  const fileName = fileNameFromUri(uri, fallbackFileName);
  const sizeBytes = typeof info.size === "number" ? info.size : 0;
  if (!sizeBytes) throw new Error("Unable to read image size.");
  const contentType = guessContentType(fileName);
  return { fileName, sizeBytes, contentType };
}

export default function DepositsScreen() {
  const router = useRouter();
  const { accounts, loading: accountsLoading, refresh: refreshAccounts } = useAccounts();
  const { deposits, loading: depositsLoading, submitDeposit, error: depositError } = useDeposits();
  const { submit: submitWithdrawal, loading: withdrawalLoading, error: withdrawalError } = useAtmWithdrawals();

  const [activeTab, setActiveTab] = useState<"deposit" | "withdraw">("deposit");

  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [depositMethod, setDepositMethod] = useState<"check" | "atm">("check");
  const [frontImageUri, setFrontImageUri] = useState("");
  const [backImageUri, setBackImageUri] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [withdrawAccountId, setWithdrawAccountId] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);

  const eligibleAccounts = accounts.filter(
    (a) => a.status === "Open" && (a.type === "Checking" || a.type === "Savings")
  );

  const handleSubmitDeposit = async () => {
    if (!accountId || !amount) {
      Alert.alert("Error", "Please select an account and enter an amount");
      return;
    }

    const parsedAmount = Number.parseFloat(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      Alert.alert("Error", "Enter a valid amount greater than 0");
      return;
    }

    if (depositMethod === "check" && (!frontImageUri || !backImageUri)) {
      Alert.alert("Error", "Check deposits require a front and back image URI");
      return;
    }

    try {
      setSubmitting(true);
      if (depositMethod === "atm") {
        await submitDeposit({
          accountId,
          amount: parsedAmount,
          depositMethod: "atm",
          depositType: "cash",
          note: note.trim() || undefined,
        });
      } else {
        const [frontMeta, backMeta] = await Promise.all([
          getUploadMeta(frontImageUri, "front.jpg"),
          getUploadMeta(backImageUri, "back.jpg"),
        ]);

        const uploadTargets = await api.getDepositUploadUrls({
          frontFileName: frontMeta.fileName,
          backFileName: backMeta.fileName,
          frontContentType: frontMeta.contentType,
          backContentType: backMeta.contentType,
          frontFileSizeBytes: frontMeta.sizeBytes,
          backFileSizeBytes: backMeta.sizeBytes,
        });

        await Promise.all([
          api.uploadDepositImage(uploadTargets.front, frontImageUri, frontMeta.contentType),
          api.uploadDepositImage(uploadTargets.back, backImageUri, backMeta.contentType),
        ]);

        await submitDeposit({
          accountId,
          amount: parsedAmount,
          depositMethod: "check",
          depositType: "check",
          note: note.trim() || undefined,
          frontImagePath: uploadTargets.front.path,
          backImagePath: uploadTargets.back.path,
        });
      }

      Alert.alert("Success", "Deposit submitted successfully");
      setAmount("");
      setNote("");
      setFrontImageUri("");
      setBackImageUri("");
      await refreshAccounts();
    } catch (err) {
      const message = err instanceof Error ? err.message : depositError || "Failed to submit deposit";
      Alert.alert("Error", message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitWithdrawal = async () => {
    if (!withdrawAccountId || !withdrawAmount) {
      Alert.alert("Error", "Select an account and enter an amount");
      return;
    }

    const parsedAmount = Number.parseFloat(withdrawAmount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      Alert.alert("Error", "Enter a valid amount greater than 0");
      return;
    }

    try {
      setWithdrawing(true);
      await submitWithdrawal(withdrawAccountId, parsedAmount);
      Alert.alert("Success", "ATM withdrawal completed");
      setWithdrawAmount("");
      await refreshAccounts();
    } catch (err) {
      const message = err instanceof Error ? err.message : withdrawalError || "Failed to submit ATM withdrawal";
      Alert.alert("Error", message);
    } finally {
      setWithdrawing(false);
    }
  };

  return (
    <Screen>
      <PageHeader
        title="Money In/Out"
        eyebrow="ATM banking"
        subtitle="Deposit by ATM or check, and withdraw cash from eligible accounts."
      />
      {accountsLoading ? (
        <Card>
          <Text>Loading accounts...</Text>
        </Card>
      ) : (
        <>
          <Card>
            <Text style={{ fontWeight: "800", fontSize: 18 }}>Actions</Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Button
                  label="Deposit"
                  variant={activeTab === "deposit" ? "primary" : "secondary"}
                  onPress={() => setActiveTab("deposit")}
                  disabled={submitting || depositsLoading || withdrawing || withdrawalLoading}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  label="Withdraw (ATM)"
                  variant={activeTab === "withdraw" ? "primary" : "secondary"}
                  onPress={() => setActiveTab("withdraw")}
                  disabled={submitting || depositsLoading || withdrawing || withdrawalLoading}
                />
              </View>
            </View>
          </Card>

          {activeTab === "deposit" ? (
            <Card>
              <Text style={{ fontWeight: "800", fontSize: 18 }}>Make a deposit</Text>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button
                    label="Check"
                    variant={depositMethod === "check" ? "primary" : "secondary"}
                    onPress={() => setDepositMethod("check")}
                    disabled={submitting || depositsLoading}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    label="ATM cash"
                    variant={depositMethod === "atm" ? "primary" : "secondary"}
                    onPress={() => setDepositMethod("atm")}
                    disabled={submitting || depositsLoading}
                  />
                </View>
              </View>

              <Text style={{ fontWeight: "700" }}>Deposit into</Text>
              {eligibleAccounts.length === 0 ? (
                <Text>No eligible accounts found (need an open checking or savings account).</Text>
              ) : (
                eligibleAccounts.map((account) => (
                  <Row
                    key={account.id}
                    title={account.nickname}
                    subtitle={`${account.type} ${account.maskedNumber} • Available ${formatCurrency(account.balances.availableBalance)}`}
                    right={account.id === accountId ? <Text style={{ fontWeight: "800" }}>Selected</Text> : undefined}
                    onPress={() => setAccountId(account.id)}
                  />
                ))
              )}

              <Field label="Amount" value={amount} onChangeText={setAmount} placeholder="0.00" />
              <Field label="Note (optional)" value={note} onChangeText={setNote} placeholder="Memo for this deposit" />

              {depositMethod === "check" ? (
                <>
                  <Field
                    label="Front image URI"
                    value={frontImageUri}
                    onChangeText={setFrontImageUri}
                    placeholder="file:///.../front.jpg"
                  />
                  <Field
                    label="Back image URI"
                    value={backImageUri}
                    onChangeText={setBackImageUri}
                    placeholder="file:///.../back.jpg"
                  />
                  <Text style={{ color: "#6B7280" }}>
                    Paste device file URIs for now. (Image picker/camera UI not wired yet.)
                  </Text>
                </>
              ) : null}

              <Button label="Submit deposit" onPress={handleSubmitDeposit} disabled={submitting || depositsLoading} />
            </Card>
          ) : (
            <Card>
              <Text style={{ fontWeight: "800", fontSize: 18 }}>ATM withdrawal</Text>
              <Text style={{ color: "#6B7280" }}>Withdrawals are available from open checking and savings accounts.</Text>
              <Text style={{ fontWeight: "700" }}>Withdraw from</Text>
              {eligibleAccounts.length === 0 ? (
                <Text>No eligible accounts found (need an open checking or savings account).</Text>
              ) : (
                eligibleAccounts.map((account) => (
                  <Row
                    key={account.id}
                    title={account.nickname}
                    subtitle={`${account.type} ${account.maskedNumber} • Available ${formatCurrency(account.balances.availableBalance)}`}
                    right={account.id === withdrawAccountId ? <Text style={{ fontWeight: "800" }}>Selected</Text> : undefined}
                    elevated
                    onPress={() => setWithdrawAccountId(account.id)}
                  />
                ))
              )}
              <Field label="Amount" value={withdrawAmount} onChangeText={setWithdrawAmount} placeholder="0.00" />
              <Button
                label={withdrawing || withdrawalLoading ? "Submitting..." : "Submit withdrawal"}
                onPress={handleSubmitWithdrawal}
                disabled={withdrawing || withdrawalLoading}
              />
            </Card>
          )}

          <Card>
            <Text style={{ fontWeight: "800", fontSize: 18 }}>Recent deposits</Text>
            {deposits.length === 0 ? (
              <Text>No deposits yet.</Text>
            ) : (
              deposits.map((deposit) => (
                <Row
                  key={deposit.id}
                  title={deposit.id}
                  subtitle={`${formatDateTime(deposit.submittedAt)} • ${formatCurrency(deposit.amount)}`}
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
