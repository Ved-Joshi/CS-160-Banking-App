import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { Alert, Text } from "react-native";
import { Card, LinkButton, PageHeader, Row, Screen, StatusChip } from "../../../src/components/ui";
import { formatCurrency, formatDate } from "../../../src/lib/format";
import { useAccounts, useTransactions } from "../../../src/lib/hooks";

export default function AccountDetailScreen() {
  const { accountId: accountIdParam } = useLocalSearchParams<{ accountId: string | string[] }>();
  const accountId = Array.isArray(accountIdParam) ? accountIdParam[0] : accountIdParam;
  const router = useRouter();
  const { accounts, loading: accountsLoading, refresh: refreshAccounts, closeAccount } = useAccounts();
  const { transactions, refresh: refreshTransactions } = useTransactions(accountId);
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);
  const [closing, setClosing] = useState(false);

  const onRefresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      await Promise.all([refreshAccounts(), refreshTransactions()]);
    } finally {
      setRefreshing(false);
      refreshingRef.current = false;
    }
  }, [refreshAccounts, refreshTransactions]);

  const account = useMemo(() => accounts.find((item) => item.id === accountId), [accounts, accountId]);
  const rows = useMemo(() => transactions.filter((txn) => txn.accountId === accountId), [transactions, accountId]);
  const closeBlockedReasons = account?.closeReasons?.length ? account.closeReasons : [];

  const handleClose = useCallback(() => {
    if (!account) return;

    if (!account.canClose) {
      const body = closeBlockedReasons.length
        ? closeBlockedReasons.join("\n")
        : "This account can't be closed yet. Make sure the balance is $0.00 and pending activity is cleared.";
      Alert.alert("Can't close account", body);
      return;
    }

    Alert.alert(
      "Close account?",
      `This will close "${account.nickname}" and remove it from your active accounts.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Close account",
          style: "destructive",
          onPress: () => {
            if (closing) return;
            setClosing(true);
            closeAccount(account.id)
              .then(() => {
                router.replace("/accounts");
              })
              .catch((err) => {
                Alert.alert("Unable to close account", err instanceof Error ? err.message : "Failed to close account");
              })
              .finally(() => setClosing(false));
          },
        },
      ]
    );
  }, [account, closeAccount, closeBlockedReasons, closing, router]);

  if (accountsLoading) {
    return (
      <Screen>
        <Card>
          <Text style={{ fontWeight: "800" }}>Loading...</Text>
        </Card>
      </Screen>
    );
  }

  if (!account) {
    return (
      <Screen refreshing={refreshing} onRefresh={onRefresh}>
        <Card>
          <Text style={{ fontWeight: "800" }}>Account not found</Text>
          <Text>Choose another account from the account summary page.</Text>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <PageHeader
        title={account.nickname}
        eyebrow={`${account.type} account`}
        subtitle={`${account.maskedNumber} | Routing ${account.routingNumber}`}
      />

      <Card>
        <Text style={{ fontWeight: "800", fontSize: 18 }}>Balance summary</Text>
        <Row title="Available balance" right={<Text>{formatCurrency(account.balances.availableBalance)}</Text>} />
        <Row title="Current balance" right={<Text>{formatCurrency(account.balances.currentBalance)}</Text>} />
        <Row title="Opened" right={<Text>{formatDate(account.openedAt)}</Text>} />
        <Row title="Status" right={<StatusChip status={account.status} />} />
      </Card>

      <Card>
        <Text style={{ fontWeight: "800", fontSize: 18 }}>Account options</Text>
        {!account.canClose ? (
          <>
            <Text>Close account is currently unavailable.</Text>
            {closeBlockedReasons.length ? (
              closeBlockedReasons.map((reason) => <Text key={reason}>• {reason}</Text>)
            ) : null}
          </>
        ) : (
          <Text>This account is eligible for closure.</Text>
        )}
        <LinkButton label="Transfer funds" onPress={() => router.push("/transfers")} />
        <LinkButton label="Set up bill pay" onPress={() => router.push("/bill-pay")} />
        <LinkButton label="View statements and activity" onPress={() => router.push("/transactions")} />
        <LinkButton label={closing ? "Closing account..." : "Close account"} onPress={handleClose} />
      </Card>

      <Card>
        <Text style={{ fontWeight: "800", fontSize: 18 }}>Recent activity</Text>
        {rows.length === 0 ? (
          <Text>No transactions found for this account.</Text>
        ) : (
          rows.map((txn) => (
            <Row
              key={txn.id}
              title={txn.description}
              subtitle={`${formatDate(txn.postedAt)} · ${txn.type}`}
              right={<Text>{txn.direction === "credit" ? "+" : "-"}{formatCurrency(txn.amount)}</Text>}
            />
          ))
        )}
      </Card>
    </Screen>
  );
}
