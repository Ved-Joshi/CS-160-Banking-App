import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, type ReactNode } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../theme/colors";

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const insets = useSafeAreaInsets();
  const content = <View style={[styles.page, { paddingBottom: 24 + insets.bottom + 72 }]}>{children}</View>;

  if (scroll) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.scrollContent}>
        {content}
      </ScrollView>
    );
  }

  return <View style={styles.screen}>{content}</View>;
}

export function Card({ children, accent = false }: { children: ReactNode; accent?: boolean }) {
  return <View style={[styles.card, accent && styles.cardAccent]}>{children}</View>;
}

export function PageHeader({ eyebrow, title, subtitle }: { eyebrow?: string; title: string; subtitle?: string }) {
  return (
    <View style={styles.headerWrap}>
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  editable = true,
}: {
  label: string;
  value: string;
  onChangeText?: (v: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  editable?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, !editable && styles.inputDisabled]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        secureTextEntry={secureTextEntry}
        editable={editable}
      />
    </View>
  );
}

export function Button({ label, onPress, variant = "primary" }: { label: string; onPress: () => void; variant?: "primary" | "secondary" }) {
  return (
    <Pressable style={({ pressed }) => [styles.button, variant === "primary" ? styles.buttonPrimary : styles.buttonSecondary, pressed && styles.buttonPressed]} onPress={onPress}>
      <Text style={variant === "primary" ? styles.buttonPrimaryText : styles.buttonSecondaryText}>{label}</Text>
    </Pressable>
  );
}

export function LinkButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <Text style={styles.link}>{label}</Text>
    </Pressable>
  );
}

export function StatusChip({ status }: { status: string }) {
  const key = status.toLowerCase();
  const toneStyle = key.includes("completed") || key.includes("approved") || key.includes("enabled") || key.includes("open")
    ? styles.chipSuccess
    : key.includes("failed") || key.includes("declined") || key.includes("restricted")
      ? styles.chipDanger
      : styles.chipWarning;

  return (
    <View style={[styles.chip, toneStyle]}>
      <Text style={styles.chipText}>{status.replace(/_/g, " ")}</Text>
    </View>
  );
}

export function Row({ title, subtitle, right, onPress }: { title: string; subtitle?: string; right?: ReactNode; onPress?: () => void }) {
  const body = (
    <View style={styles.row}>
      <View style={styles.rowTextWrap}>
        <Text style={styles.rowTitle}>{title}</Text>
        {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );

  return onPress ? <Pressable onPress={onPress}>{body}</Pressable> : body;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  scrollContent: { paddingTop: 12 },
  page: { paddingHorizontal: 16, gap: 14 },
  card: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 20,
    padding: 16,
    gap: 12,
  },
  cardAccent: { borderColor: "rgba(177, 17, 31, 0.45)" },
  headerWrap: { gap: 6 },
  eyebrow: {
    color: colors.red700,
    textTransform: "uppercase",
    letterSpacing: 1,
    fontWeight: "800",
    fontSize: 12,
  },
  title: { color: colors.text, fontSize: 28, fontWeight: "800", lineHeight: 32 },
  subtitle: { color: colors.muted, lineHeight: 20 },
  field: { gap: 6 },
  label: { color: colors.text, fontWeight: "700" },
  input: {
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.white,
    color: colors.text,
  },
  inputDisabled: { backgroundColor: colors.surface, color: colors.muted },
  button: { borderRadius: 999, paddingVertical: 12, paddingHorizontal: 18, alignItems: "center" },
  buttonPrimary: { backgroundColor: colors.red700 },
  buttonSecondary: { backgroundColor: "rgba(16,35,59,0.08)" },
  buttonPressed: { opacity: 0.86 },
  buttonPrimaryText: { color: colors.white, fontWeight: "700" },
  buttonSecondaryText: { color: colors.navy950, fontWeight: "700" },
  link: { color: colors.linkBlue, fontWeight: "700" },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  chipText: { fontWeight: "700", fontSize: 12, textTransform: "capitalize" },
  chipSuccess: { backgroundColor: "rgba(31, 107, 71, 0.12)" },
  chipDanger: { backgroundColor: "rgba(177, 17, 31, 0.12)" },
  chipWarning: { backgroundColor: "rgba(138, 90, 0, 0.12)" },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
  },
  rowTextWrap: { flex: 1, gap: 2 },
  rowTitle: { color: colors.text, fontWeight: "700" },
  rowSubtitle: { color: colors.muted, fontSize: 13 },
});
