import type { ReactNode } from "react";
import { useState } from "react";
import { Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../theme/colors";

export function Screen({
  children,
  scroll = true,
  refreshing,
  onRefresh,
}: {
  children: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const content = <View style={[styles.page, { paddingBottom: 24 + insets.bottom + 72 }]}>{children}</View>;

  if (scroll) {
    return (
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={Boolean(refreshing)}
              onRefresh={onRefresh}
              tintColor={colors.red700}
            />
          ) : undefined
        }
      >
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

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  placeholder = "Select…",
  disabled = false,
}: {
  label: string;
  value: T | null;
  options: { label: string; value: T | null }[];
  onChange: (v: T | null) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        onPress={() => {
          if (disabled) return;
          setOpen(true);
        }}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.selectTrigger,
          disabled && styles.inputDisabled,
          pressed && !disabled && styles.selectPressed,
        ]}
      >
        <Text style={[styles.selectValue, !selected && styles.selectPlaceholder]} numberOfLines={1}>
          {selected?.label ?? placeholder}
        </Text>
        <Text style={styles.selectChevron}>›</Text>
      </Pressable>

      <Modal transparent animationType="fade" visible={open} onRequestClose={() => setOpen(false)}>
        <View style={styles.selectOverlay}>
          <Pressable style={styles.selectOverlay} onPress={() => setOpen(false)} />
          <View style={styles.selectSheet}>
            <Text style={styles.selectTitle}>{label}</Text>
            <ScrollView style={{ maxHeight: 320 }} contentContainerStyle={{ paddingVertical: 6 }}>
              {options.map((opt) => {
                const isSelected = opt.value === value;
                return (
                  <Pressable
                    key={`${label}:${String(opt.value)}`}
                    onPress={() => {
                      onChange(opt.value);
                      setOpen(false);
                    }}
                    style={({ pressed }) => [styles.selectOption, pressed && styles.selectOptionPressed]}
                  >
                    <Text style={[styles.selectOptionLabel, isSelected && styles.selectOptionSelected]}>{opt.label}</Text>
                    {isSelected ? <Text style={styles.selectOptionSelected}>Selected</Text> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

export function Button({ label, onPress, variant = "primary", disabled = false }: { label: string; onPress: () => void; variant?: "primary" | "secondary"; disabled?: boolean }) {
  return (
    <Pressable style={({ pressed }) => [styles.button, variant === "primary" ? styles.buttonPrimary : styles.buttonSecondary, pressed && styles.buttonPressed, disabled && styles.buttonDisabled]} onPress={onPress} disabled={disabled}>
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

export function Row({
  title,
  subtitle,
  right,
  onPress,
  elevated = false,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onPress?: () => void;
  elevated?: boolean;
}) {
  const body = (
    <View style={styles.row}>
      <View style={styles.rowTextWrap}>
        <Text style={styles.rowTitle}>{title}</Text>
        {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );

  return onPress ? (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.rowPressable,
        elevated && styles.rowPressableElevated,
        pressed && styles.rowPressablePressed,
      ]}
    >
      {body}
    </Pressable>
  ) : (
    body
  );
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
  selectTrigger: {
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.white,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  selectPressed: { backgroundColor: "rgba(16,35,59,0.04)" },
  selectValue: { color: colors.text, flex: 1 },
  selectPlaceholder: { color: colors.muted },
  selectChevron: { color: colors.muted, fontSize: 18, fontWeight: "800" },
  selectOverlay: { flex: 1, justifyContent: "center", padding: 18, backgroundColor: "rgba(16, 35, 59, 0.45)" },
  selectSheet: {
    backgroundColor: colors.white,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(177, 17, 31, 0.25)",
    padding: 16,
    gap: 10,
  },
  selectTitle: { fontSize: 18, fontWeight: "800", color: colors.text },
  selectOption: {
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  selectOptionPressed: { backgroundColor: "rgba(16,35,59,0.06)" },
  selectOptionLabel: { color: colors.text, fontWeight: "700", flex: 1 },
  selectOptionSelected: { color: colors.red700, fontWeight: "800" },
  button: { borderRadius: 999, paddingVertical: 12, paddingHorizontal: 18, alignItems: "center" },
  buttonPrimary: { backgroundColor: colors.red700 },
  buttonSecondary: { backgroundColor: "rgba(16,35,59,0.08)" },
  buttonPressed: { opacity: 0.86 },
  buttonDisabled: { opacity: 0.5 },
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
  rowPressable: {
    borderRadius: 14,
    marginHorizontal: -6,
    paddingHorizontal: 6,
  },
  rowPressableElevated: {
    marginHorizontal: 0,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: "rgba(212,221,232,0.9)",
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
    marginTop: 8,
  },
  rowPressablePressed: { backgroundColor: "rgba(16,35,59,0.06)" },
  rowTextWrap: { flex: 1, gap: 2 },
  rowTitle: { color: colors.text, fontWeight: "700" },
  rowSubtitle: { color: colors.muted, fontSize: 13 },
});
