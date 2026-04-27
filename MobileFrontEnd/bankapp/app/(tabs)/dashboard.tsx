import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Card, LinkButton, PageHeader, Screen, StatusChip } from "../../src/components/ui";
import { formatCurrency, formatDate } from "../../src/lib/format";
import { colors } from "../../src/theme/colors";
import { useAccounts, useTransactions, useBillPayments, useDeposits } from "../../src/lib/hooks";
import { useAuth } from "../../src/auth/AuthContext";

const DASHBOARD_MIN_REFRESH_MS = 15_000;

export default function DashboardScreen() {
  const router = useRouter();
  const { accounts, loading: accountsLoading, refresh: refreshAccounts } = useAccounts();
  const { transactions, refresh: refreshTransactions } = useTransactions({ limit: 25 });
  const { payments, refresh: refreshPayments } = useBillPayments();
  const { deposits, refresh: refreshDeposits } = useDeposits();
  const { user } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);
  const lastRefreshMsRef = useRef(0);

  useEffect(() => {
    // Hooks already auto-fetch on mount; avoid immediately double-fetching via focus refresh.
    lastRefreshMsRef.current = Date.now();
  }, []);

  const onRefresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      await Promise.all([refreshAccounts(), refreshTransactions(), refreshPayments(), refreshDeposits()]);
      lastRefreshMsRef.current = Date.now();
    } finally {
      setRefreshing(false);
      refreshingRef.current = false;
    }
  }, [refreshAccounts, refreshDeposits, refreshPayments, refreshTransactions]);

  useFocusEffect(
    useCallback(() => {
      const now = Date.now();
      if (now - lastRefreshMsRef.current < DASHBOARD_MIN_REFRESH_MS) return;
      void onRefresh();
    }, [onRefresh])
  );
  
  const totalAvailable = accounts.reduce((sum, account) => sum + account.balances.availableBalance, 0);
  const pendingDeposit = deposits.find((deposit) => deposit.status === "PENDING_REVIEW");

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <PageHeader
        eyebrow="Account overview"
        title={`Good evening, ${user?.firstName || user?.email || 'there'}.`}
        subtitle="See balances, recent activity, and the items that still need your attention."
      />

      {pendingDeposit ? (
        <Card>
          <Text style={styles.alertTitle}>Deposit pending review</Text>
          <Text style={styles.alertBody}>Your deposit for {formatCurrency(pendingDeposit.amount)} was submitted on {formatDate(pendingDeposit.submittedAt)}.</Text>
        </Card>
      ) : null}

      {accountsLoading ? (
        <Card>
          <Text>Loading accounts...</Text>
        </Card>
      ) : (
        <>
          <View style={styles.heroCard}>
            <Text style={styles.heroEyebrow}>Available across linked accounts</Text>
            <Text style={styles.heroValue}>{formatCurrency(totalAvailable)}</Text>
            <View style={styles.actionRow}>
              <LinkButton label="Transfer money" onPress={() => router.push("/transfers")} />
              <LinkButton label="Pay bills" onPress={() => router.push("/bill-pay")} />
              <LinkButton label="Deposit check" onPress={() => router.push("/deposits")} />
            </View>
          </View>

          <Card>
            <View style={styles.headingRow}>
              <Text style={styles.heading}>Recent transactions</Text>
              <LinkButton label="See all" onPress={() => router.push("/transactions")} />
            </View>
            {transactions.slice(0, 4).map((transaction) => (
          <View key={transaction.id} style={styles.itemRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemTitle}>{transaction.description}</Text>
              <Text style={styles.itemSub}>{formatDate(transaction.postedAt)}</Text>
            </View>
            <View style={{ alignItems: "flex-end", gap: 4 }}>
              <Text style={styles.itemAmount}>{transaction.direction === "credit" ? "+" : "-"}{formatCurrency(transaction.amount)}</Text>
              <StatusChip status={transaction.status} />
            </View>
          </View>
            ))}
          </Card>

          <Card>
            <View style={styles.headingRow}>
              <Text style={styles.heading}>Upcoming bill payments</Text>
              <LinkButton label="Manage" onPress={() => router.push("/bill-pay")} />
            </View>
            {payments.slice(0, 3).map((payment) => (
          <View key={payment.id} style={styles.itemRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemTitle}>{payment.payeeName}</Text>
              <Text style={styles.itemSub}>Deliver by {formatDate(payment.deliverBy)}</Text>
            </View>
            <View style={{ alignItems: "flex-end", gap: 4 }}>
              <Text style={styles.itemAmount}>{formatCurrency(payment.amount)}</Text>
              <StatusChip status={payment.status} />
            </View>
          </View>
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  alertTitle: { color: colors.warning, fontWeight: "800" },
  alertBody: { color: colors.text },
  heroCard: {
    borderRadius: 22,
    padding: 18,
    backgroundColor: colors.navy950,
    gap: 8,
  },
  heroEyebrow: { color: "rgba(255,255,255,0.7)", fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, fontSize: 12 },
  heroValue: { color: colors.white, fontWeight: "800", fontSize: 34 },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  headingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  heading: { color: colors.text, fontSize: 18, fontWeight: "800" },
  itemRow: { flexDirection: "row", justifyContent: "space-between", gap: 12, borderTopWidth: 1, borderTopColor: "rgba(212,221,232,0.7)", paddingTop: 10, marginTop: 6 },
  itemTitle: { color: colors.text, fontWeight: "700" },
  itemSub: { color: colors.muted },
  itemAmount: { color: colors.navy950, fontWeight: "800" },
});
