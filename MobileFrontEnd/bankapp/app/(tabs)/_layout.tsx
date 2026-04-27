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
            transactions: "receipt-outline",
            "accounts/index": "wallet-outline",
            transfers: "swap-horizontal-outline",
            "bill-pay/index": "receipt-outline",
            more: "ellipsis-horizontal-circle-outline",
          };
          const icon = map[route.name] ?? "ellipse-outline";
          return <Ionicons name={icon} size={size} color={color} />;
        },
      })}
    >
      <Tabs.Screen name="dashboard" options={{ title: "Dashboard", tabBarLabel: "Dashboard" }} />
      <Tabs.Screen name="transactions" options={{ title: "Transactions", tabBarLabel: "Transactions" }} />
      <Tabs.Screen name="accounts/index" options={{ title: "Accounts", tabBarLabel: "Accounts" }} />
      <Tabs.Screen name="more" options={{ title: "More", tabBarLabel: "More" }} />

      <Tabs.Screen name="transfers" options={{ href: null }} />
      <Tabs.Screen name="bill-pay/index" options={{ href: null }} />
      <Tabs.Screen name="accounts/new" options={{ href: null }} />
      <Tabs.Screen name="accounts/[accountId]" options={{ href: null }} />
      <Tabs.Screen name="bill-pay/payees" options={{ href: null }} />
      <Tabs.Screen name="deposits/index" options={{ href: null }} />
      <Tabs.Screen name="deposits/[depositId]" options={{ href: null }} />
      <Tabs.Screen name="atm-locator" options={{ href: null }} />
      <Tabs.Screen name="notifications" options={{ href: null }} />
      <Tabs.Screen name="settings" options={{ href: null }} />
    </Tabs>
  );
}
