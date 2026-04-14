import { useRouter } from "expo-router";
import { useState } from "react";
import { Text } from "react-native";
import { useAuth } from "../../src/auth/AuthContext";
import { Button, Card, Field, LinkButton, PageHeader, Screen } from "../../src/components/ui";
import { colors } from "../../src/theme/colors";

export default function ResetPasswordScreen() {
  const router = useRouter();
  const { requestReset } = useAuth();
  const [email, setEmail] = useState("alex.morgan@examplebank.com");
  const [error, setError] = useState("");
  const [sentTo, setSentTo] = useState("");

  const onSubmit = async () => {
    const message = await requestReset(email);
    if (message) {
      setError(message);
      return;
    }
    setError("");
    setSentTo(email);
  };

  return (
    <Screen>
      <Card>
        <PageHeader
          eyebrow="Account recovery"
          title="Forgot password"
          subtitle="Enter your email address and we will send password reset instructions."
        />
        {error ? <Text style={{ color: colors.red700, fontWeight: "700" }}>{error}</Text> : null}
        {sentTo ? <Text style={{ color: colors.success, fontWeight: "700" }}>Reset link sent to {sentTo}</Text> : null}
        <Field label="Email address" value={email} onChangeText={setEmail} />
        <Button label="Send link" onPress={onSubmit} />
        <LinkButton label="Back to sign in" onPress={() => router.push("/login")} />
      </Card>
    </Screen>
  );
}
