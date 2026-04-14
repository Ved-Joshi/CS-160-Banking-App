import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { useAuth } from "../../src/auth/AuthContext";
import { Button, Card, Field, LinkButton, PageHeader, Screen } from "../../src/components/ui";
import { colors } from "../../src/theme/colors";

export default function RegisterScreen() {
  const router = useRouter();
  const { isAuthenticated, register } = useAuth();
  const [firstName, setFirstName] = useState("Alex");
  const [lastName, setLastName] = useState("Morgan");
  const [email, setEmail] = useState("alex.morgan@examplebank.com");
  const [password, setPassword] = useState("Password123");
  const [error, setError] = useState("");

  if (isAuthenticated) {
    return <Redirect href="/dashboard" />;
  }

  const onRegister = async () => {
    if (firstName.length < 2 || lastName.length < 2) {
      setError("Enter first and last name.");
      return;
    }
    const message = await register({ firstName, lastName, email, password });
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
          eyebrow="New customer"
          title="Enroll in online banking"
          subtitle="Create secure online access for your personal banking profile."
        />
        {error ? <Text style={{ color: colors.red700, fontWeight: "700" }}>{error}</Text> : null}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Field label="First name" value={firstName} onChangeText={setFirstName} />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Last name" value={lastName} onChangeText={setLastName} />
          </View>
        </View>
        <Field label="Email" value={email} onChangeText={setEmail} />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry />
        <Button label="Create access" onPress={onRegister} />
        <LinkButton label="Already enrolled? Sign in" onPress={() => router.push("/login")} />
      </Card>
    </Screen>
  );
}
