import { countriesPopularFirst, countryByCode, flagEmoji, POPULAR_COUNTRY_CODES, searchCountries, type Country } from "@illuminize/shared";
import { useMemo, useState } from "react";
import { FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, radius, spacing, useTheme } from "@/theme";

const ALL = countriesPopularFirst();
const POPULAR_COUNT = POPULAR_COUNTRY_CODES.length;

export interface CountryPickerProps {
  label: string;
  /** ISO country code, or null when nothing is chosen. */
  value: string | null;
  onChange: (code: string | null) => void;
  /** "dial" shows "🇮🇳 +91" in the field and the calling code in each row (phone number entry). */
  variant?: "country" | "dial";
  clearable?: boolean;
  error?: string;
  placeholder?: string;
}

/** A field that opens a full-screen, searchable list of every country (name, ISO code or calling code). */
export function CountryPicker({ label, value, onChange, variant = "country", clearable, error, placeholder = "Choose a country" }: CountryPickerProps) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const selected = countryByCode(value);
  const results = useMemo(() => (q.trim() ? searchCountries(q, ALL) : ALL), [q]);
  const fieldText = selected ? (variant === "dial" ? `${flagEmoji(selected.code)} ${selected.dial}` : `${flagEmoji(selected.code)} ${selected.name}`) : placeholder;

  const pick = (c: Country | null) => {
    onChange(c?.code ?? null);
    setOpen(false);
    setQ("");
  };

  return (
    <View style={{ gap: 4 }}>
      <Text style={{ fontSize: 13, fontWeight: "600", color: "#334155" }}>{label}</Text>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label}${selected ? `, ${selected.name}${variant === "dial" ? ` ${selected.dial}` : ""}` : ""}`}
        style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderColor: error ? colors.danger : colors.border, backgroundColor: "#fff", borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 12 }}
      >
        <Text style={{ fontSize: 15, color: selected ? colors.text : colors.faint }} numberOfLines={1}>
          {fieldText}
        </Text>
        <Text style={{ color: colors.faint }}>▾</Text>
      </Pressable>
      {error ? <Text style={{ color: colors.danger, fontSize: 12 }}>{error}</Text> : null}

      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={["top", "bottom", "left", "right"]}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.lg, paddingBottom: spacing.sm }}>
              <Text style={{ flex: 1, fontSize: 17, fontWeight: "700", color: colors.text }}>{label}</Text>
              <Pressable onPress={() => setOpen(false)} accessibilityRole="button" accessibilityLabel="Close" hitSlop={12}>
                <Text style={{ fontSize: 15, color: theme.primary, fontWeight: "600" }}>Close</Text>
              </Pressable>
            </View>
            <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}>
              <TextInput
                value={q}
                onChangeText={setQ}
                placeholder="Search by name or code (e.g. India, +44)"
                placeholderTextColor={colors.faint}
                autoFocus
                autoCorrect={false}
                accessibilityLabel="Search countries"
                style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: "#fff", borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: colors.text }}
              />
            </View>
            <FlatList
              data={results}
              keyExtractor={(c) => c.code}
              keyboardShouldPersistTaps="handled"
              initialNumToRender={30}
              ListHeaderComponent={
                clearable && value ? (
                  <Pressable onPress={() => pick(null)} accessibilityRole="button" style={{ paddingHorizontal: spacing.lg, paddingVertical: 14 }}>
                    <Text style={{ fontSize: 15, color: colors.muted }}>No country</Text>
                  </Pressable>
                ) : undefined
              }
              ListEmptyComponent={<Text style={{ padding: spacing.lg, color: colors.muted }}>No country matches “{q}”.</Text>}
              renderItem={({ item, index }) => {
                const active = item.code === value;
                return (
                  <Pressable
                    onPress={() => pick(item)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      gap: spacing.md,
                      paddingHorizontal: spacing.lg,
                      paddingVertical: 12,
                      backgroundColor: active ? theme.primarySoft : pressed ? "#f1f5f9" : "transparent",
                      borderBottomWidth: !q && index === POPULAR_COUNT - 1 ? 6 : 0,
                      borderBottomColor: colors.border,
                    })}
                  >
                    <Text style={{ fontSize: 20 }}>{flagEmoji(item.code)}</Text>
                    <Text style={{ flex: 1, fontSize: 15, color: colors.text }}>{item.name}</Text>
                    <Text style={{ fontSize: 14, color: colors.muted }}>{variant === "dial" ? item.dial : item.code}</Text>
                  </Pressable>
                );
              }}
            />
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}
