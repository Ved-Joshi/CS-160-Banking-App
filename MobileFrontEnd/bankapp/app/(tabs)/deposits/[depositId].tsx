import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text } from "react-native";
import { Card, PageHeader, Row, Screen, StatusChip } from "../../../src/components/ui";
import { formatCurrency, formatDateTime } from "../../../src/lib/format";
import { useDeposits } from "../../../src/lib/hooks";

export default function DepositDetailScreen() {
  const { depositId } = useLocalSearchParams<{ depositId: string }>();
  const { deposits, loading, getDeposit } = useDeposits();
  const [loadingSingle, setLoadingSingle] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);
  
  const deposit = useMemo(() => deposits.find((item) => item.id === depositId), [deposits, depositId]);

  const onRefresh = useCallback(async () => {
    if (!depositId || refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      await getDeposit(String(depositId));
    } finally {
      setRefreshing(false);
      refreshingRef.current = false;
    }
  }, [depositId, getDeposit]);

  useEffect(() => {
    if (!depositId || deposit) return;
    setLoadingSingle(true);
    getDeposit(String(depositId))
      .catch(() => null)
      .finally(() => setLoadingSingle(false));
  }, [deposit, depositId, getDeposit]);

  if (loading || loadingSingle) {
    return (
      <Screen>
        <Card>
          <Text style={{ fontWeight: "800" }}>Loading...</Text>
        </Card>
      </Screen>
    );
  }

  if (!deposit) {
    return (
      <Screen refreshing={refreshing} onRefresh={onRefresh}>
        <Card>
          <Text style={{ fontWeight: "800" }}>Deposit not found</Text>
          <Text>The requested deposit could not be located.</Text>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <PageHeader title={`Deposit ${deposit.id}`} eyebrow="Deposit tracking" subtitle="Follow review status and image submission details." />
      <Card>
        <Row title="Amount" right={<Text>{formatCurrency(deposit.amount)}</Text>} />
        <Row title="Submitted" right={<Text>{formatDateTime(deposit.submittedAt)}</Text>} />
        <Row title="Status" right={<StatusChip status={deposit.status} />} />
      </Card>
      <Card>
        <Text style={{ fontWeight: "800", fontSize: 18 }}>Status timeline</Text>
        <Text>1. Images uploaded</Text>
        <Text>2. Manual review</Text>
        <Text>3. Funds availability</Text>
        <Text>{deposit.note ?? "No additional notes"}</Text>
      </Card>
    </Screen>
  );
}
