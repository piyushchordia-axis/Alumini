import { useState } from "react";
import { FlatList, Modal, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { toggleState } from "@/components/ui";
import { colors, radius, spacing, useTheme } from "@/theme";

export interface PickerOption<T extends string> {
  value: T;
  label: string;
}

export interface OptionPickerProps<T extends string> {
  label: string;
  value: T | null;
  options: readonly PickerOption<T>[];
  onChange: (value: T | null) => void;
  /** Shown in the field while nothing is chosen. */
  placeholder?: string;
  /** With a choice made, a first row with this label clears it. */
  clearLabel?: string;
  error?: string;
  hint?: string;
}

/**
 * A field that opens a full-screen list to choose one of a fixed set of options from, as CountryPicker does for countries:
 * for a list too long for a row of chips (an industry), where a native select would differ on each platform.
 */
export function OptionPicker<T extends string>({ label, value, options, onChange, placeholder = "Choose", clearLabel, error, hint }: OptionPickerProps<T>) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value) ?? null;

  const pick = (next: T | null) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <View style={{ gap: 4 }}>
      <Text style={{ fontSize: 13, fontWeight: "600", color: "#334155" }}>{label}</Text>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${selected ? selected.label : placeholder}`}
        style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, minHeight: 46, borderWidth: 1, borderColor: error ? colors.danger : colors.border, backgroundColor: "#fff", borderRadius: radius.md, paddingHorizontal: 12 }}
      >
        <Text style={{ flexShrink: 1, fontSize: 15, color: selected ? colors.text : colors.faint }} numberOfLines={1}>
          {selected ? selected.label : placeholder}
        </Text>
        <Text style={{ color: colors.faint }}>▾</Text>
      </Pressable>
      {error ? <Text style={{ color: colors.danger, fontSize: 12 }}>{error}</Text> : hint ? <Text style={{ color: colors.muted, fontSize: 12 }}>{hint}</Text> : null}

      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={["top", "bottom", "left", "right"]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm }}>
            <Text role="heading" style={{ flex: 1, fontSize: 17, fontWeight: "700", color: colors.text }}>
              {label}
            </Text>
            <Pressable onPress={() => setOpen(false)} accessibilityRole="button" accessibilityLabel="Close" style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontSize: 15, color: theme.primary, fontWeight: "600" }}>Close</Text>
            </Pressable>
          </View>
          <FlatList
            data={options}
            keyExtractor={(o) => o.value}
            initialNumToRender={30}
            ListHeaderComponent={
              clearLabel && value ? (
                <Pressable onPress={() => pick(null)} accessibilityRole="button" style={{ minHeight: 48, justifyContent: "center", paddingHorizontal: spacing.lg }}>
                  <Text style={{ fontSize: 15, color: colors.muted }}>{clearLabel}</Text>
                </Pressable>
              ) : undefined
            }
            renderItem={({ item }) => {
              const active = item.value === value;
              return (
                <Pressable
                  onPress={() => pick(item.value)}
                  accessibilityRole="button"
                  {...toggleState(active)}
                  style={({ pressed }) => ({ minHeight: 48, justifyContent: "center", paddingHorizontal: spacing.lg, backgroundColor: active ? theme.primarySoft : pressed ? "#f1f5f9" : "transparent" })}
                >
                  <Text style={{ fontSize: 15, color: active ? theme.primary : colors.text, fontWeight: active ? "600" : "400" }}>{item.label}</Text>
                </Pressable>
              );
            }}
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}
