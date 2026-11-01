import { formatProfileFieldValue, type ProfileFieldDto, type ProfileFieldValue } from "@illuminize/shared";
import { Text, View } from "react-native";
import { DateTimeField } from "@/components/DateTimeField";
import { Chip, ChipSelect, Input, Muted } from "@/components/ui";
import { colors, useTheme } from "@/theme";

export type FieldAnswers = Record<string, ProfileFieldValue | null>;

export const answersToValues = (answers: { key: string; value: ProfileFieldValue | null }[] | undefined): FieldAnswers =>
  Object.fromEntries((answers ?? []).map((a) => [a.key, a.value]));

/** Inputs for the institution's own profile questions; admin-managed ones show their answer as text. */
export function CustomFieldInputs({
  fields,
  values,
  errors,
  onChange,
}: {
  fields: ProfileFieldDto[];
  values: FieldAnswers;
  errors: Record<string, string>;
  onChange: (key: string, value: ProfileFieldValue | null) => void;
}) {
  const theme = useTheme();
  return (
    <>
      {fields.map((f) => {
        const v = values[f.key] ?? null;
        const label = `${f.label}${f.required ? " *" : ""}`;
        const hint = [f.helpText, f.visibility === "ADMINS" ? "Only you and the admins see this." : null].filter(Boolean).join(" ") || undefined;
        if (!f.memberEditable) {
          return (
            <View key={f.key} style={{ gap: 4 }}>
              <Text style={{ fontWeight: "600", color: colors.text }}>{f.label}</Text>
              <Text style={{ color: colors.text }}>{formatProfileFieldValue(f, v) || "—"}</Text>
              <Muted>Set by your institution&apos;s admins.</Muted>
            </View>
          );
        }
        const error = errors[f.key] || undefined;
        switch (f.type) {
          case "TEXT":
          case "LONG_TEXT":
            return <Input key={f.key} label={label} value={typeof v === "string" ? v : ""} onChangeText={(t) => onChange(f.key, t)} multiline={f.type === "LONG_TEXT"} maxLength={f.type === "TEXT" ? 200 : 2000} hint={hint} error={error} />;
          case "NUMBER":
            return (
              <Input
                key={f.key}
                label={label}
                value={typeof v === "number" ? String(v) : typeof v === "string" ? v : ""}
                onChangeText={(t) => onChange(f.key, t.trim() === "" ? null : Number.isFinite(Number(t)) ? Number(t) : t)}
                keyboardType="numeric"
                hint={hint}
                error={error}
              />
            );
          case "DATE":
            return <DateTimeField key={f.key} label={label} mode="date" value={typeof v === "string" ? v : null} onChange={(d) => onChange(f.key, d)} error={error} clearable />;
          case "BOOLEAN":
            return (
              <View key={f.key} style={{ gap: 4 }}>
                <ChipSelect label={label} options={[{ value: "true", label: "Yes" }, { value: "false", label: "No" }]} value={v === true ? "true" : v === false ? "false" : ""} onChange={(c) => onChange(f.key, c === "" ? null : c === "true")} allowEmpty={!f.required} />
                {error ? <Text style={{ color: colors.danger, fontSize: 12 }}>{error}</Text> : hint ? <Muted>{hint}</Muted> : null}
              </View>
            );
          case "SELECT":
            return (
              <View key={f.key} style={{ gap: 4 }}>
                <ChipSelect label={label} options={f.options} value={typeof v === "string" ? v : ""} onChange={(c) => onChange(f.key, c || null)} allowEmpty={!f.required} />
                {error ? <Text style={{ color: colors.danger, fontSize: 12 }}>{error}</Text> : hint ? <Muted>{hint}</Muted> : null}
              </View>
            );
          case "MULTI_SELECT": {
            const chosen = Array.isArray(v) ? v : [];
            return (
              <View key={f.key} style={{ gap: 6 }}>
                <Text style={{ fontWeight: "600", color: colors.text, fontSize: 13 }}>{label}</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {f.options.map((o) => {
                    const on = chosen.includes(o.value);
                    return <Chip key={o.value} label={o.label} active={on} color={theme.primary} onPress={() => onChange(f.key, on ? chosen.filter((x) => x !== o.value) : [...chosen, o.value])} />;
                  })}
                </View>
                {error ? <Text style={{ color: colors.danger, fontSize: 12 }}>{error}</Text> : hint ? <Muted>{hint}</Muted> : null}
              </View>
            );
          }
        }
      })}
    </>
  );
}
