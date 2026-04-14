import { useRouter } from "expo-router";
import { Card, LinkButton, PageHeader, Screen } from "../../src/components/ui";

export default function MoreScreen() {
  const router = useRouter();

  return (
    <Screen>
      <PageHeader title="More" eyebrow="Additional pages" subtitle="Access the rest of the banking experience from one place." />
      <Card>
        <LinkButton label="Deposits" onPress={() => router.push("/(tabs)/deposits")} />
        <LinkButton label="Transactions" onPress={() => router.push("/(tabs)/transactions")} />
        <LinkButton label="ATM Locator" onPress={() => router.push("/(tabs)/atm-locator")} />
        <LinkButton label="Notifications" onPress={() => router.push("/(tabs)/notifications")} />
        <LinkButton label="Settings" onPress={() => router.push("/(tabs)/settings")} />
      </Card>
    </Screen>
  );
}
