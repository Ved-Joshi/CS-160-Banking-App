import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import { Text } from "react-native";
import { useAuth } from "../../src/auth/AuthContext";
import { Button, Card, Field, LinkButton, PageHeader, Screen } from "../../src/components/ui";
import { colors } from "../../src/theme/colors";

export default function LoginScreen() {
  const router = useRouter();
  const { isAuthenticated, login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  if (isAuthenticated) {
    return <Redirect href="/dashboard" />;
  }

  const onSubmit = async () => {
    const message = await login(email, password);
    if (message) {
      setError(message);
      return;
    }
    setError("");
    router.replace("/dashboard");
  };

  return (
    <Screen>
      <Card>
        <PageHeader
          eyebrow="Online access"
          title="Sign in"
          subtitle="Your accounts, statements, and payments in one place."
        />
        {error ? <Text style={{ color: colors.red700, fontWeight: "700" }}>{error}</Text> : null}
        <Field label="Email address" placeholder="you@example.com" value={email} onChangeText={setEmail} />
        <Field label="Password" placeholder="Enter your password" value={password} onChangeText={setPassword} secureTextEntry />
        <Button label="Continue" onPress={onSubmit} />
        <LinkButton label="Forgot password?" onPress={() => router.push("/reset-password")} />
        <LinkButton label="Need online access? Enroll now" onPress={() => router.push("/register")} />
      </Card>
    </Screen>
  );
}
