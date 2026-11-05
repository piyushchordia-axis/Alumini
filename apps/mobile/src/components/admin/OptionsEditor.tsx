import { MAX_PROFILE_FIELD_OPTIONS, uniqueOptionValue, type ProfileFieldOption } from "@illuminize/shared";
import { useState } from "react";
import { Platform, Pressable, View } from "react-native";
import { IconClose } from "@/components/icons";
import { Button, Input, Muted } from "@/components/ui";
import { colors, radius, spacing } from "@/theme";

/** Return adds an option and keeps the keyboard up: `submitBehavior` says so on a phone, the older `blurOnSubmit` on the web export. */
const keepFocusOnWeb = Platform.OS === "web" ? ({ blurOnSubmit: false } as object) : {};

/**
 * A choice question's options: each label editable in place, with a remove button, then a box that adds one with Return
 * or Add. A new option's value is its label slugged, different from the others'; an edited label keeps its value, so
 * answers already given stay on it.
 */
export function OptionsEditor({ options, onChange }: { options: ProfileFieldOption[]; onChange: (options: ProfileFieldOption[]) => void }) {
  const [draft, setDraft] = useState("");
  const full = options.length >= MAX_PROFILE_FIELD_OPTIONS;
  const add = () => {
    const label = draft.trim();
    if (!label || full) return;
    onChange([...options, { value: uniqueOptionValue(options, label), label }]);
    setDraft("");
  };
  return (
    <View style={{ gap: spacing.sm }}>
      {options.map((o, i) => (
        <View key={o.value} style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
          <View style={{ flex: 1 }}>
            <Input accessibilityLabel={`Option ${i + 1}`} value={o.label} maxLength={100} onChangeText={(label) => onChange(options.map((x, j) => (j === i ? { ...x, label } : x)))} />
          </View>
          <Pressable
            onPress={() => onChange(options.filter((_, j) => j !== i))}
            accessibilityRole="button"
            accessibilityLabel={`Remove option ${o.label}`}
            style={({ pressed }) => ({ width: 44, height: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? colors.bg : "transparent" })}
          >
            <IconClose size={18} color={colors.muted} />
          </Pressable>
        </View>
      ))}
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Input
            accessibilityLabel="New option"
            placeholder={full ? `${MAX_PROFILE_FIELD_OPTIONS} options added` : "Add an option…"}
            value={draft}
            onChangeText={setDraft}
            maxLength={100}
            editable={!full}
            returnKeyType="done"
            submitBehavior="submit"
            {...keepFocusOnWeb}
            onSubmitEditing={add}
          />
        </View>
        <Button title="Add" variant="outline" disabled={full || !draft.trim()} onPress={add} />
      </View>
      <Muted>Removing an option keeps it on profiles that already chose it.</Muted>
    </View>
  );
}
