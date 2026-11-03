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
import { Text, View } from "react-native";
import { useFormErrors } from "@/components/forms/useFormErrors";
import { Button, Choice, ErrorText, Input } from "@/components/ui";
import { colors, spacing } from "@/theme";

const legend = { fontSize: 13, fontWeight: "600", color: "#334155" } as const;
const hint = { fontSize: 12, color: colors.muted } as const;
/** Areas sit two to a row; availability choices are a column, where a basis would set their height instead. */
const twoAcross = { flexBasis: "47%", flexGrow: 1 } as const;

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
            return <Choice key={a} kind="checkbox" label={MENTOR_AREA_LABELS[a]} checked={checked} disabled={full && !checked} onPress={() => toggleArea(a)} style={twoAcross} />;
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
