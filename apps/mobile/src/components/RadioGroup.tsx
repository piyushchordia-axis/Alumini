import { Text, View } from "react-native";
import { Choice, FieldError } from "@/components/ui";
import { colors, spacing } from "@/theme";

/**
 * A labelled set of radio Choices, one of which is chosen: in place of a select, which differs on each platform. `hint`
 * says what the choice decides, under the label.
 */
export function RadioGroup<T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
  error,
}: {
  label: string;
  hint?: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  error?: string;
}) {
  return (
    <View role="radiogroup" aria-label={label} style={{ gap: spacing.sm }}>
      <Text style={{ fontSize: 13, fontWeight: "600", color: "#334155" }}>{label}</Text>
      {hint ? <Text style={{ fontSize: 12, color: colors.muted }}>{hint}</Text> : null}
      {options.map((o) => (
        <Choice key={o.value} kind="radio" label={o.label} checked={value === o.value} onPress={() => onChange(o.value)} />
      ))}
      <FieldError error={error} />
    </View>
  );
}
