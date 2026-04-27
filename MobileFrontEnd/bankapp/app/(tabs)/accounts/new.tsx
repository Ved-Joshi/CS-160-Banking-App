import { useState } from "react";
import { useRouter } from "expo-router";
import { Text, View } from "react-native";
import { useAccounts } from "../../../src/lib/hooks";
import { Button, Card, Field, LinkButton, PageHeader, Screen } from "../../../src/components/ui";
import { colors } from "../../../src/theme/colors";

const accountTypes = ["checking", "savings", "credit"] as const;

export default function NewAccountScreen() {
  const router = useRouter();
  const { createAccount } = useAccounts();
  const [accountType, setAccountType] = useState<(typeof accountTypes)[number]>("checking");
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const onCreate = async () => {
    const trimmedNickname = nickname.trim();
    const finalNickname = trimmedNickname || `${accountType.charAt(0).toUpperCase() + accountType.slice(1)} account`;

    if (finalNickname.length < 2) {
      setError("Enter a nickname of at least 2 characters.");
      return;
    }

    try {
      setSaving(true);
      setError("");
      await createAccount(accountType, finalNickname);
      router.replace("/accounts");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create account.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <Card>
        <PageHeader
          eyebrow="New account"
          title="Open an account"
          subtitle="Create a checking, savings, or credit account and manage it instantly."
        />
        {error ? <Text style={{ color: colors.red700, fontWeight: "700" }}>{error}</Text> : null}
        <Card accent>
          <Text style={{ fontWeight: "800" }}>Account type</Text>
          <View style={{ gap: 10 }}>
            {accountTypes.map((type) => (
              <Button
                key={type}
                label={type.charAt(0).toUpperCase() + type.slice(1)}
                variant={accountType === type ? "primary" : "secondary"}
                onPress={() => setAccountType(type)}
              />
            ))}
          </View>
        </Card>
        <Field
          label="Account nickname"
          placeholder="Optional nickname"
          value={nickname}
          onChangeText={setNickname}
        />
        <Button label={saving ? "Opening account..." : "Open account"} onPress={onCreate} disabled={saving} />
        <LinkButton label="Back to accounts" onPress={() => router.back()} />
      </Card>
    </Screen>
  );
}
