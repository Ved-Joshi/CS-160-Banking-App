import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { useAuth } from "../../src/auth/AuthContext";
import { Button, Card, Field, LinkButton, PageHeader, Screen } from "../../src/components/ui";
import { colors } from "../../src/theme/colors";

export default function RegisterScreen() {
  const router = useRouter();
  const { isAuthenticated, register } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [mobilePhone, setMobilePhone] = useState("");
  const [streetAddress, setStreetAddress] = useState("");
  const [apartmentUnit, setApartmentUnit] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  if (isAuthenticated && !submitting) {
    return <Redirect href="/dashboard" />;
  }

  const onRegister = async () => {
    setSubmitting(true);
    const phoneDigits = mobilePhone.replace(/\D/g, "");
    const dob = new Date(dateOfBirth);
    const today = new Date();
    const adultCutoff = new Date(today.getFullYear() - 18, today.getMonth(), today.getDate());

    if (firstName.trim().length < 2 || lastName.trim().length < 2) {
      setError("Enter first and last name.");
      setSubmitting(false);
      return;
    }

    if (!email.includes("@") || password.length < 8) {
      setError("Use a valid email and at least 8 characters for password.");
      setSubmitting(false);
      return;
    }

    if (!/^[0-9]{10,15}$/.test(phoneDigits)) {
      setError("Enter a valid phone number.");
      setSubmitting(false);
      return;
    }

    if (!streetAddress.trim() || !city.trim() || !/^[A-Z]{2}$/.test(state.trim().toUpperCase()) || !/^\d{5}(?:-\d{4})?$/.test(zipCode.trim())) {
      setError("Provide a valid address, city, state, and ZIP code.");
      setSubmitting(false);
      return;
    }

    if (!dateOfBirth || Number.isNaN(dob.getTime()) || dob > adultCutoff) {
      setError("You must be at least 18 years old.");
      setSubmitting(false);
      return;
    }

    const message = await register({
      firstName: firstName.trim(),
      middleName: middleName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      mobilePhone: phoneDigits,
      streetAddress: streetAddress.trim(),
      apartmentUnit: apartmentUnit.trim(),
      city: city.trim(),
      state: state.trim().toUpperCase(),
      zipCode: zipCode.trim(),
      dateOfBirth: dateOfBirth.trim(),
      password,
    });

    if (message) {
      setError(message);
      setSubmitting(false);
      return;
    }

    setError("");
    setSubmitting(false);
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
            <Field label="First name" placeholder="First name" value={firstName} onChangeText={setFirstName} />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Middle name (optional)" placeholder="Middle name" value={middleName} onChangeText={setMiddleName} />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Last name" placeholder="Last name" value={lastName} onChangeText={setLastName} />
          </View>
        </View>
        <Field label="Email" placeholder="you@example.com" value={email} onChangeText={setEmail} />
        <Field label="Mobile phone" placeholder="555-123-4567" value={mobilePhone} onChangeText={setMobilePhone} />
        <Field label="Street address" placeholder="123 Main St" value={streetAddress} onChangeText={setStreetAddress} />
        <Field label="Apartment / unit (optional)" placeholder="Unit 4B" value={apartmentUnit} onChangeText={setApartmentUnit} />
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Field label="City" placeholder="City" value={city} onChangeText={setCity} />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="State" placeholder="CA" value={state} onChangeText={setState} />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="ZIP code" placeholder="12345" value={zipCode} onChangeText={setZipCode} />
          </View>
        </View>
        <Field label="Date of birth" placeholder="YYYY-MM-DD" value={dateOfBirth} onChangeText={setDateOfBirth} />
        <Field label="Password" placeholder="At least 8 characters" value={password} onChangeText={setPassword} secureTextEntry />
        <Button label={submitting ? "Creating access..." : "Create access"} onPress={onRegister} disabled={submitting} />
        <LinkButton label="Already enrolled? Sign in" onPress={() => router.push("/login")} />
      </Card>
    </Screen>
  );
}
