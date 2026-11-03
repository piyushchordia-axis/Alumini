import {
  MENTOR_AREA_LABELS,
  MENTOR_AREAS,
  MENTOR_AVAILABILITIES,
  MENTOR_AVAILABILITY_LABELS,
  MENTOR_AVAILABILITY_NOTE_MAX_LENGTH,
  MENTOR_MAX_AREAS,
  MENTOR_NOTE_MAX_LENGTH,
  mentorProfileUpsertSchema,
  type MentorArea,
  type MentorAvailability,
  type MentorProfileDto,
  type MentorProfileUpsert,
} from "@illuminize/shared";
import { isApiClientError } from "@illuminize/shared/client";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useFormErrors } from "@/components/forms/useFormErrors";
import { Button, ErrorText, Input } from "@/components/ui";
import { colors, radius, spacing, useTheme } from "@/theme";

const legend = { fontSize: 13, fontWeight: "600", color: "#334155" } as const;
const hint = { fontSize: 12, color: colors.muted } as const;

/** One choice, as a checkbox for an area or a radio for availability: 44 points tall, its state in aria-checked. */
function Choice({ kind, label, checked, disabled = false, onPress }: { kind: "checkbox" | "radio"; label: string; checked: boolean; disabled?: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={kind}
      accessibilityLabel={label}
      // The ARIA forms, which React Native maps on devices and react-native-web emits.
      aria-checked={checked}
      aria-disabled={disabled}
      style={({ pressed }) => ({
        // Areas sit two to a row; availability choices are a column, where a basis would set their height instead.
        ...(kind === "checkbox" ? { flexBasis: "47%", flexGrow: 1 } : null),
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
        minHeight: 44,
        borderWidth: 1,
        borderRadius: radius.md,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderColor: checked ? theme.primary : colors.border,
        backgroundColor: disabled ? colors.bg : checked ? theme.primarySoft : pressed ? colors.bg : colors.card,
      })}
    >
      <View
        style={{
          width: 20,
          height: 20,
          borderRadius: kind === "checkbox" ? 5 : 10,
          borderWidth: 2,
          borderColor: checked ? theme.primary : disabled ? colors.border : colors.faint,
          backgroundColor: kind === "checkbox" && checked ? theme.primary : "transparent",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {checked && (kind === "checkbox" ? <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>✓</Text> : <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.primary }} />)}
      </View>
      {/* Long labels wrap inside their box rather than widening it. */}
      <Text style={{ flex: 1, fontSize: 14, color: disabled ? colors.faint : colors.text }}>{label}</Text>
    </Pressable>
  );
}

/**
 * What a mentor offers: up to five areas from a fixed list, how often they can meet, and two optional notes. Saving lists
 * them in Mentors, again too if they had stopped. Checked against the same schema as the API before anything is sent.
 */
export function MentorProfileForm({ profile, onSave }: { profile: MentorProfileDto | null; onSave: (input: MentorProfileUpsert) => Promise<unknown> }) {
  const [areas, setAreas] = useState<MentorArea[]>(profile?.areas ?? []);
  const [availability, setAvailability] = useState<MentorAvailability | "">(profile?.availability ?? "");
  const [availabilityNote, setAvailabilityNote] = useState(profile?.availabilityNote ?? "");
  const [note, setNote] = useState(profile?.note ?? "");
  const { errors, setErrors, serverError, busy, fromZod, run } = useFormErrors();
  const full = areas.length >= MENTOR_MAX_AREAS;

  const toggleArea = (area: MentorArea) => setAreas((now) => (now.includes(area) ? now.filter((a) => a !== area) : [...now, area]));

  const submit = () =>
    run(async () => {
      const parsed = mentorProfileUpsertSchema.safeParse({ areas, availability: availability || undefined, availabilityNote, note });
      if (!parsed.success) return fromZod(parsed.error);
      try {
        await onSave(parsed.data);
      } catch (err) {
        const fields = isApiClientError(err) ? Object.entries(err.fieldErrors) : [];
        if (!fields.length) throw err;
        // "areas.2" is about the areas as a whole, as far as this form can say.
        setErrors(Object.fromEntries(fields.map(([path, message]) => [path.split(".")[0], message])));
      }
    });

  return (
    <View style={{ gap: spacing.lg }}>
      <View role="group" aria-label="Mentor areas" style={{ gap: spacing.sm }}>
        <Text style={legend}>Mentor areas *</Text>
        <Text style={hint}>
          Choose up to {MENTOR_MAX_AREAS}. {areas.length} chosen.
        </Text>
        {/* Two across even on a phone, or twelve choices make a very long form. */}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          {MENTOR_AREAS.map((a) => {
            const checked = areas.includes(a);
            return <Choice key={a} kind="checkbox" label={MENTOR_AREA_LABELS[a]} checked={checked} disabled={full && !checked} onPress={() => toggleArea(a)} />;
          })}
        </View>
        <ErrorText error={errors.areas} />
      </View>

      <View role="radiogroup" aria-label="Availability" style={{ gap: spacing.sm }}>
        <Text style={legend}>Availability *</Text>
        {MENTOR_AVAILABILITIES.map((v) => (
          <Choice key={v} kind="radio" label={MENTOR_AVAILABILITY_LABELS[v]} checked={availability === v} onPress={() => setAvailability(v)} />
        ))}
        <ErrorText error={errors.availability} />
      </View>

      <Input
        label="Availability note"
        value={availabilityNote}
        onChangeText={setAvailabilityNote}
        maxLength={MENTOR_AVAILABILITY_NOTE_MAX_LENGTH}
        autoComplete="off"
        hint="Optional. When you're usually free, for example weekday evenings, UK time."
        error={errors.availabilityNote}
      />
      <Input
        label="Note to mentees"
        value={note}
        onChangeText={setNote}
        multiline
        maxLength={MENTOR_NOTE_MAX_LENGTH}
        autoComplete="off"
        hint={`Optional. What you can help with, shown on your mentor page. ${note.length} / ${MENTOR_NOTE_MAX_LENGTH}`}
        error={errors.note}
      />
      <ErrorText error={serverError} />
      <Button title="Save mentor profile" loading={busy} onPress={() => void submit()} />
    </View>
  );
}
