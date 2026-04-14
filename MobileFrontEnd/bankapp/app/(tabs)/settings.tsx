import { useRouter } from "expo-router";
import { Text } from "react-native";
import { useAuth } from "../../src/auth/AuthContext";
import { Button, Card, PageHeader, Row, Screen } from "../../src/components/ui";
import { mockProfile } from "../../src/data/mockData";
import { formatDate } from "../../src/lib/format";

export default function SettingsScreen() {
  const router = useRouter();
  const { signOut } = useAuth();

  return (
    <Screen>
      <PageHeader title="Settings" eyebrow="Profile and security" subtitle="Review your profile details and manage your security preferences." />
      <Card>
        <Text style={{ fontWeight: "800", fontSize: 18 }}>Profile</Text>
        <Row title="Name" right={<Text>{mockProfile.fullName}</Text>} />
        <Row title="Email" right={<Text>{mockProfile.email}</Text>} />
        <Row title="Phone" right={<Text>{mockProfile.phone}</Text>} />
        <Row title="Member since" right={<Text>{formatDate(mockProfile.memberSince)}</Text>} />
      </Card>
      <Card>
        <Text style={{ fontWeight: "800", fontSize: 18 }}>Security</Text>
        <Button label="Reset password" variant="secondary" onPress={() => router.push("/reset-password")} />
        <Button label="Notification preferences" variant="secondary" onPress={() => router.push("/notifications")} />
      </Card>
      <Button
        label="Sign out"
        onPress={async () => {
          await signOut();
          router.replace("/welcome");
        }}
        variant="secondary"
      />
    </Screen>
  );
}
