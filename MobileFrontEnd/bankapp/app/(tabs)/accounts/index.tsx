import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useRef, useState } from "react";
import { Text, View } from "react-native";
import { Button, Card, LinkButton, PageHeader, Screen, StatusChip } from "../../../src/components/ui";
import { colors } from "../../../src/theme/colors";
import { formatCurrency } from "../../../src/lib/format";
import { useAccounts } from "../../../src/lib/hooks";

const ACCOUNTS_MIN_REFRESH_MS = 15_000;

export default function AccountsScreen() {
  const router = useRouter();
  const { accounts, loading, error, refresh } = useAccounts();
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);
  const lastRefreshMsRef = useRef(0);

  const onRefresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      await refresh();
      lastRefreshMsRef.current = Date.now();
    } finally {
      setRefreshing(false);
      refreshingRef.current = false;
    }
  }, [refresh]);

  useFocusEffect(
    useCallback(() => {
      if (loading) return;
      const now = Date.now();
      if (now - lastRefreshMsRef.current < ACCOUNTS_MIN_REFRESH_MS) return;
      void onRefresh();
    }, [loading, onRefresh])
  );

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <PageHeader
        title="Accounts"
        eyebrow="Balances and details"
        subtitle="Review current and available balances across your linked products."
      />
      <Button label="Open a new account" onPress={() => router.push("/accounts/new")} />
      {error ? (
        <Card>
          <Text style={{ color: colors.red700, fontWeight: "700" }}>Unable to load accounts</Text>
          <Text>{error}</Text>
          <LinkButton label="Retry" onPress={onRefresh} />
        </Card>
      ) : loading ? (
        <Card>
          <Text>Loading accounts...</Text>
        </Card>
      ) : accounts.length === 0 ? (
        <Card>
          <Text>No accounts found. Create one to get started.</Text>
          <LinkButton label="Open a new account" onPress={() => router.push("/accounts/new")} />
        </Card>
      ) : (
        accounts.map((account) => (
          <Card key={account.id}>
            <Text style={{ fontWeight: "800" }}>{account.type}</Text>
            <Text style={{ fontSize: 20, fontWeight: "800" }}>{account.nickname}</Text>
            <Text style={{ opacity: 0.8 }}>{account.maskedNumber}</Text>
            <View style={{ gap: 4 }}>
              <Text>Available: {formatCurrency(account.balances.availableBalance)}</Text>
              <Text>Current: {formatCurrency(account.balances.currentBalance)}</Text>
            </View>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <StatusChip status={account.status} />
              <LinkButton label="View activity" onPress={() => router.push(`/accounts/${account.id}`)} />
            </View>
          </Card>
        ))
      )}
    </Screen>
  );
}
