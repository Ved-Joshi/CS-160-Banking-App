import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { Text } from "react-native";
import { useAuth } from "../../src/auth/AuthContext";
import type { CustomerProfile } from "../../src/types";
import { Button, Card, PageHeader, Row, Screen } from "../../src/components/ui";
import { formatDate } from "../../src/lib/format";

export default function SettingsScreen() {
  const router = useRouter();
  const { signOut, user, getProfile } = useAuth();
  const [profile, setProfile] = useState<CustomerProfile | null>(null);

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const fetched = await getProfile();
        setProfile(fetched);
      } catch {
        setProfile(null);
      }
    };

    loadProfile();
  }, [getProfile]);

  const displayName = profile?.fullName || (user ? `${user.firstName} ${user.lastName}`.trim() : "-");
  const displayEmail = profile?.email || user?.email || "-";
  const displayPhone = profile?.phone || "-";
  const displayMemberSince = profile?.memberSince || "-";

  return (
    <Screen>
      <PageHeader title="Settings" eyebrow="Profile and security" subtitle="Review your profile details and manage your security preferences." />
      <Card>
        <Text style={{ fontWeight: "800", fontSize: 18 }}>Profile</Text>
        <Row title="Name" right={<Text>{displayName}</Text>} />
        <Row title="Email" right={<Text>{displayEmail}</Text>} />
        <Row title="Phone" right={<Text>{displayPhone}</Text>} />
        <Row title="Member since" right={<Text>{displayMemberSince !== "-" ? formatDate(displayMemberSince) : "-"}</Text>} />
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
