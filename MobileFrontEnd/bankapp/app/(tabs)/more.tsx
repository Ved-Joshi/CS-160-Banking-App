import { useRouter } from "expo-router";
import { Card, PageHeader, Row, Screen } from "../../src/components/ui";

export default function MoreScreen() {
  const router = useRouter();

  return (
    <Screen>
      <PageHeader title="More" eyebrow="Additional pages" subtitle="Access the rest of the banking experience from one place." />
      <Card>
        <Row title="Deposits / Withdrawals" subtitle="Deposit checks or withdraw cash at an ATM" elevated onPress={() => router.push("/(tabs)/deposits")} />
        <Row title="Transactions" subtitle="Review and filter account activity" elevated onPress={() => router.push("/(tabs)/transactions")} />
        <Row title="Transfers" subtitle="Move money between accounts" elevated onPress={() => router.push("/(tabs)/transfers")} />
        <Row title="Bill Pay" subtitle="Schedule one-time or recurring payments" elevated onPress={() => router.push("/(tabs)/bill-pay")} />
        <Row title="ATM Locator" subtitle="Find nearby ATMs and get directions" elevated onPress={() => router.push("/(tabs)/atm-locator")} />
      </Card>
      <Card>
        <Row title="Notifications" subtitle="Deposit reviews, payment updates, security alerts" elevated onPress={() => router.push("/(tabs)/notifications")} />
        <Row title="Settings" subtitle="Profile, security, and preferences" elevated onPress={() => router.push("/(tabs)/settings")} />
      </Card>
    </Screen>
  );
}
