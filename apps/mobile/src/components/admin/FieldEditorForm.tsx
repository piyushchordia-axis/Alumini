import {
  CHOICE_TYPES,
  FIELD_FILTER_HINT,
  FIELD_VISIBILITY_OPTIONS,
  PROFILE_FIELD_TYPES,
  PROFILE_FIELD_TYPE_LABELS,
  emptyFieldDraft,
  fieldCanFilter,
  normalizeFieldBody,
  profileFieldFormErrors,
  slugifyKey,
  type ProfileFieldDraft,
  type ProfileFieldDto,
} from "@illuminize/shared";
import { useState } from "react";
import { Platform, Text, View } from "react-native";
import { OptionsEditor } from "@/components/admin/OptionsEditor";
import { useFormErrors } from "@/components/forms/useFormErrors";
import { OptionPicker } from "@/components/OptionPicker";
import { RadioGroup } from "@/components/RadioGroup";
import { Button, Choice, ErrorText, FieldError, Input } from "@/components/ui";
import { colors, spacing } from "@/theme";

const MONO = Platform.select({ ios: "Menlo", default: "monospace" });
const TYPE_OPTIONS = PROFILE_FIELD_TYPES.map((t) => ({ value: t, label: PROFILE_FIELD_TYPE_LABELS[t] }));

/**
 * The profile-field editor, as the web console's field dialog: `field` to edit, or null for a new one, whose key follows
 * its question until the key is typed in. The body is checked as the API checks it before it's sent.
 */
export function FieldEditorForm({ field, onSubmit }: { field: ProfileFieldDto | null; onSubmit: (body: ProfileFieldDraft) => Promise<void> }) {
  const isNew = !field;
  const [v, setV] = useState<ProfileFieldDraft>(() => emptyFieldDraft(field));
  const [keyTouched, setKeyTouched] = useState(!isNew);
  const { errors, setErrors, serverError, busy, run } = useFormErrors();
  const set = <K extends keyof ProfileFieldDraft>(key: K, value: ProfileFieldDraft[K]) => setV((s) => ({ ...s, [key]: value }));
  const canFilter = fieldCanFilter(v.type, v.visibility);

  const submit = () =>
    run(async () => {
      const body = normalizeFieldBody(v);
      const problems = profileFieldFormErrors(body, isNew);
      if (Object.keys(problems).length > 0) return setErrors(problems);
      await onSubmit(body);
    });

  return (
    <View style={{ gap: spacing.lg }}>
      <Input
        label="Question *"
        value={v.label}
        maxLength={80}
        placeholder="e.g. House, Roll number, Hostel"
        autoComplete="off"
        error={errors.label}
        onChangeText={(label) => setV((s) => ({ ...s, label, ...(keyTouched ? {} : { key: slugifyKey(label) }) }))}
      />
      <Input
        label="Key *"
        value={v.key}
        editable={isNew}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        maxLength={40}
        style={{ fontFamily: MONO, ...(isNew ? null : { backgroundColor: colors.bg, color: colors.muted }) }}
        hint={isNew ? "Used in CSV imports and exports. Can't be changed later." : "Can't be changed."}
        error={errors.key}
        onChangeText={(key) => {
          setKeyTouched(true);
          set("key", key);
        }}
      />
      <OptionPicker label="Answer type" value={v.type} options={TYPE_OPTIONS} onChange={(type) => type && set("type", type)} hint={isNew ? undefined : "Can't change once members have answered."} error={errors.type} />
      <RadioGroup label="Who can see answers" value={v.visibility} options={FIELD_VISIBILITY_OPTIONS} onChange={(visibility) => set("visibility", visibility)} error={errors.visibility} />
      <Input label="Help text" value={v.helpText ?? ""} maxLength={200} placeholder="Shown under the question" error={errors.helpText} onChangeText={(t) => set("helpText", t || null)} />
      {CHOICE_TYPES.includes(v.type) && (
        <View role="group" aria-label="Options" style={{ gap: spacing.sm }}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: "#334155" }}>Options *</Text>
          <OptionsEditor options={v.options} onChange={(options) => set("options", options)} />
          <FieldError error={errors.options} />
        </View>
      )}
      <View style={{ gap: spacing.sm }}>
        <Choice kind="checkbox" label="Required when joining" checked={v.required} onPress={() => set("required", !v.required)} />
        <Choice kind="checkbox" label="Only admins fill this in (members can't change it)" checked={!v.memberEditable} onPress={() => set("memberEditable", !v.memberEditable)} />
        <Choice
          kind="checkbox"
          label="Members can filter the directory by it"
          checked={canFilter && v.filterable}
          disabled={!canFilter}
          hint={canFilter ? undefined : FIELD_FILTER_HINT}
          onPress={() => set("filterable", !v.filterable)}
        />
        {!canFilter && <Text style={{ marginLeft: 41, fontSize: 12, color: colors.muted }}>{FIELD_FILTER_HINT}</Text>}
        <FieldError error={errors.filterable} />
      </View>
      {/* A problem with a box near the top is said here too, where the admin is looking. */}
      <ErrorText error={serverError ?? Object.values(errors)[0] ?? null} />
      <Button title={isNew ? "Add field" : "Save"} loading={busy} disabled={!v.label.trim() || !v.key} onPress={() => void submit()} />
    </View>
  );
}
