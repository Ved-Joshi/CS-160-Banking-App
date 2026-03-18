import { Redirect, useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../../src/auth/AuthContext";
import { Button, Card, LinkButton, PageHeader, Screen } from "../../src/components/ui";
import { colors } from "../../src/theme/colors";

export default function WelcomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isAuthenticated } = useAuth();

  if (isAuthenticated) {
    return <Redirect href="/dashboard" />;
  }

  return (
    <Screen>
      <View style={[styles.hero, { marginTop: insets.top + 4 }]}> 
        <Text style={styles.brand}>SJ State Bank</Text>
        <Text style={styles.heroTitle}>Bank with confidence.</Text>
        <Text style={styles.heroBody}>Secure online banking designed to keep your everyday finances within reach.</Text>
      </View>

      <Card>
        <PageHeader
          eyebrow="Secure access"
          title="Online Banking"
          subtitle="Sign in to manage accounts, transfers, bill pay, deposits, and nearby ATMs."
        />
        <Button label="Sign in" onPress={() => router.push("/login")} />
        <LinkButton label="Enroll now" onPress={() => router.push("/register")} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: colors.navy950,
    borderRadius: 24,
    padding: 20,
    gap: 10,
  },
  brand: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 12,
    letterSpacing: 1,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  heroTitle: {
    color: colors.white,
    fontSize: 34,
    lineHeight: 38,
    fontWeight: "800",
  },
  heroBody: {
    color: "rgba(255,255,255,0.82)",
    lineHeight: 20,
  },
});
