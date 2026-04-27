import { useState } from "react";
import { useRouter } from "expo-router";
import { Alert, Text } from "react-native";
import { useAuth } from "../../src/auth/AuthContext";
import type { CustomerProfile } from "../../src/types";
import { Button, Card, Field, PageHeader, Row, Screen } from "../../src/components/ui";
import { formatDate } from "../../src/lib/format";
import { useProfile } from "../../src/lib/hooks";

export default function SettingsScreen() {
  const router = useRouter();
  const { signOut, user } = useAuth();
  const { profile, loading: profileLoading, update } = useProfile();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    firstName: "",
    middleName: "",
    lastName: "",
    phone: "",
    streetAddress: "",
    apartmentUnit: "",
    city: "",
    state: "",
    zipCode: "",
  });

  const displayName = profile?.fullName || (user ? `${user.firstName} ${user.lastName}`.trim() : "-");
  const displayEmail = profile?.email || user?.email || "-";
  const displayPhone = profile?.phone || "-";
  const displayMemberSince = profile?.memberSince || "-";

  const handleStartEdit = () => {
    setDraft({
      firstName: profile?.firstName ?? user?.firstName ?? "",
      middleName: profile?.middleName ?? "",
      lastName: profile?.lastName ?? user?.lastName ?? "",
      phone: profile?.phone === "—" ? "" : profile?.phone ?? "",
      streetAddress: profile?.streetAddress ?? "",
      apartmentUnit: profile?.apartmentUnit ?? "",
      city: profile?.city ?? "",
      state: profile?.state ?? "",
      zipCode: profile?.zipCode ?? "",
    });
    setEditing(true);
  };

  const handleSave = async () => {
    const payload = {
      firstName: draft.firstName.trim(),
      middleName: draft.middleName.trim() || undefined,
      lastName: draft.lastName.trim(),
      phone: draft.phone.trim(),
      streetAddress: draft.streetAddress.trim(),
      apartmentUnit: draft.apartmentUnit.trim() || undefined,
      city: draft.city.trim(),
      state: draft.state.trim().toUpperCase(),
      zipCode: draft.zipCode.trim(),
    };

    if (
      !payload.firstName ||
      !payload.lastName ||
      !payload.phone ||
      !payload.streetAddress ||
      !payload.city ||
      payload.state.length !== 2 ||
      !payload.zipCode
    ) {
      Alert.alert("Missing info", "Fill out name, phone, and full address (state must be 2 letters).");
      return;
    }

    try {
      await update(payload);
      setEditing(false);
      Alert.alert("Saved", "Profile updated.");
    } catch (err) {
      Alert.alert("Error", err instanceof Error ? err.message : "Failed to update profile");
    }
  };

  return (
    <Screen>
      <PageHeader title="Settings" eyebrow="Profile and security" subtitle="Review your profile details and manage your security preferences." />
      <Card>
        <Text style={{ fontWeight: "800", fontSize: 18 }}>Profile</Text>
        {profileLoading ? (
          <Text>Loading profile...</Text>
        ) : editing ? (
          <>
            <Field label="First name" value={draft.firstName} onChangeText={(v) => setDraft((p) => ({ ...p, firstName: v }))} />
            <Field label="Middle name (optional)" value={draft.middleName} onChangeText={(v) => setDraft((p) => ({ ...p, middleName: v }))} />
            <Field label="Last name" value={draft.lastName} onChangeText={(v) => setDraft((p) => ({ ...p, lastName: v }))} />
            <Field label="Phone" value={draft.phone} onChangeText={(v) => setDraft((p) => ({ ...p, phone: v }))} />
            <Field label="Street address" value={draft.streetAddress} onChangeText={(v) => setDraft((p) => ({ ...p, streetAddress: v }))} />
            <Field label="Apt / Unit (optional)" value={draft.apartmentUnit} onChangeText={(v) => setDraft((p) => ({ ...p, apartmentUnit: v }))} />
            <Field label="City" value={draft.city} onChangeText={(v) => setDraft((p) => ({ ...p, city: v }))} />
            <Field label="State (2 letters)" value={draft.state} onChangeText={(v) => setDraft((p) => ({ ...p, state: v }))} placeholder="CA" />
            <Field label="ZIP code" value={draft.zipCode} onChangeText={(v) => setDraft((p) => ({ ...p, zipCode: v }))} placeholder="94105" />
            <Button label="Save profile" onPress={handleSave} />
            <Button label="Cancel" variant="secondary" onPress={() => setEditing(false)} />
          </>
        ) : (
          <>
            <Row title="Name" right={<Text>{displayName}</Text>} />
            <Row title="Email" right={<Text>{displayEmail}</Text>} />
            <Row title="Phone" right={<Text>{displayPhone}</Text>} />
            <Row title="Member since" right={<Text>{displayMemberSince !== "-" ? formatDate(displayMemberSince) : "-"}</Text>} />
            {profile?.address ? <Row title="Address" right={<Text>{profile.address}</Text>} /> : null}
            <Button label="Edit profile" variant="secondary" onPress={handleStartEdit} />
          </>
        )}
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
