import { Ionicons } from "@expo/vector-icons";
import { Redirect, Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../../src/auth/AuthContext";
import { colors } from "../../src/theme/colors";

export default function TabsLayout() {
  const { isAuthenticated } = useAuth();
  const insets = useSafeAreaInsets();

  if (!isAuthenticated) {
    return <Redirect href="/welcome" />;
  }

  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: colors.navy950 },
        headerTintColor: colors.white,
        headerTitleStyle: { fontWeight: "700" },
        sceneStyle: { backgroundColor: colors.background },
        tabBarActiveTintColor: colors.red700,
        tabBarInactiveTintColor: colors.linkBlue,
        tabBarStyle: {
          borderTopColor: colors.line,
          backgroundColor: colors.white,
          height: 58 + insets.bottom,
          paddingBottom: Math.max(insets.bottom, 8),
          paddingTop: 7,
        },
        tabBarIcon: ({ color, size }) => {
          const map: Record<string, keyof typeof Ionicons.glyphMap> = {
            dashboard: "grid-outline",
            accounts: "wallet-outline",
            transfers: "swap-horizontal-outline",
            "bill-pay": "receipt-outline",
            more: "ellipsis-horizontal-circle-outline",
          };
          const icon = map[route.name] ?? "ellipse-outline";
          return <Ionicons name={icon} size={size} color={color} />;
        },
      })}
    >
      <Tabs.Screen name="dashboard" options={{ title: "Dashboard", tabBarLabel: "Dashboard" }} />
      <Tabs.Screen name="accounts/index" options={{ title: "Accounts", tabBarLabel: "Accounts" }} />
      <Tabs.Screen name="transfers" options={{ title: "Transfers", tabBarLabel: "Transfers" }} />
      <Tabs.Screen name="bill-pay" options={{ title: "Bill Pay", tabBarLabel: "Bill Pay" }} />
      <Tabs.Screen name="more" options={{ title: "More", tabBarLabel: "More" }} />

      <Tabs.Screen name="accounts/[accountId]" options={{ href: null, title: "Account Details" }} />
      <Tabs.Screen name="bill-pay/payees" options={{ href: null, title: "Payees" }} />
      <Tabs.Screen name="deposits/index" options={{ href: null, title: "Deposits" }} />
      <Tabs.Screen name="deposits/[depositId]" options={{ href: null, title: "Deposit Details" }} />
      <Tabs.Screen name="transactions" options={{ href: null, title: "Transactions" }} />
      <Tabs.Screen name="atm-locator" options={{ href: null, title: "ATM Locator" }} />
      <Tabs.Screen name="notifications" options={{ href: null, title: "Notifications" }} />
      <Tabs.Screen name="settings" options={{ href: null, title: "Settings" }} />
    </Tabs>
  );
}
