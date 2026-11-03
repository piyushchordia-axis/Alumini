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
import clsx from "clsx";
import { useId, useState, type FormEvent } from "react";
import { Button, ErrorBox, FormField, Input, Textarea } from "@/components/ui";

type Field = "areas" | "availability" | "availabilityNote" | "note";

/** A field's message, said under it and tied to it for screen readers. */
function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1 text-xs text-red-600" role="alert">
      {message}
    </p>
  );
}

/**
 * What a mentor offers: up to five areas from a fixed list, how often they can meet, and two optional notes. Saving lists
 * them in Mentors, again too if they had stopped. Checked against the same schema as the API before anything is sent.
 */
export function MentorProfileForm({ profile, onSave }: { profile: MentorProfileDto | null; onSave: (input: MentorProfileUpsert) => Promise<unknown> }) {
  const id = useId();
  const [areas, setAreas] = useState<MentorArea[]>(profile?.areas ?? []);
  const [availability, setAvailability] = useState<MentorAvailability | "">(profile?.availability ?? "");
  const [availabilityNote, setAvailabilityNote] = useState(profile?.availabilityNote ?? "");
  const [note, setNote] = useState(profile?.note ?? "");
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [serverError, setServerError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const full = areas.length >= MENTOR_MAX_AREAS;

  const toggleArea = (area: MentorArea, on: boolean) => setAreas((now) => (on ? [...now, area] : now.filter((a) => a !== area)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setServerError(null);
    const parsed = mentorProfileUpsertSchema.safeParse({ areas, availability: availability || undefined, availabilityNote, note });
    if (!parsed.success) {
      const next: Partial<Record<Field, string>> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as Field;
        next[field] ??= issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await onSave(parsed.data);
    } catch (err) {
      const fields = isApiClientError(err) ? Object.entries(err.fieldErrors) : [];
      // "areas.2" is about the areas as a whole, as far as this form can say.
      if (fields.length) setErrors(Object.fromEntries(fields.map(([path, message]) => [path.split(".")[0], message])));
      else setServerError(err);
    } finally {
      setBusy(false);
    }
  };

  const choice = "relative flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-primary/30";
  return (
    <form className="space-y-5" noValidate onSubmit={(e) => void submit(e)}>
      <fieldset aria-describedby={`${id}-areas-hint${errors.areas ? ` ${id}-areas-error` : ""}`}>
        <legend className="mb-1 block text-sm font-medium text-slate-700">
          Mentor areas<span className="text-red-500"> *</span>
        </legend>
        <p id={`${id}-areas-hint`} className="mb-2 text-xs text-slate-500">
          Choose up to {MENTOR_MAX_AREAS}. {areas.length} chosen.
        </p>
        {/* Two across even on a phone, or twelve choices make a very long form. Long labels wrap inside their box. */}
        <div className="grid grid-cols-2 gap-2">
          {MENTOR_AREAS.map((a) => {
            const checked = areas.includes(a);
            const off = full && !checked;
            return (
              <label key={a} className={clsx(choice, checked ? "border-primary bg-primary/5 text-slate-900" : off ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400" : "border-slate-300 text-slate-800 hover:border-slate-400")}>
                <input type="checkbox" className="h-4 w-4 shrink-0 accent-primary" checked={checked} disabled={off} onChange={(e) => toggleArea(a, e.target.checked)} />
                {MENTOR_AREA_LABELS[a]}
              </label>
            );
          })}
        </div>
        <FieldError id={`${id}-areas-error`} message={errors.areas} />
      </fieldset>

      <fieldset aria-describedby={errors.availability ? `${id}-availability-error` : undefined}>
        <legend className="mb-2 block text-sm font-medium text-slate-700">
          Availability<span className="text-red-500"> *</span>
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {MENTOR_AVAILABILITIES.map((v) => (
            <label key={v} className={clsx(choice, availability === v ? "border-primary bg-primary/5 text-slate-900" : "border-slate-300 text-slate-800 hover:border-slate-400")}>
              <input type="radio" name={`${id}-availability`} value={v} className="h-4 w-4 shrink-0 accent-primary" checked={availability === v} onChange={() => setAvailability(v)} />
              {MENTOR_AVAILABILITY_LABELS[v]}
            </label>
          ))}
        </div>
        <FieldError id={`${id}-availability-error`} message={errors.availability} />
      </fieldset>

      <FormField label="Availability note" error={errors.availabilityNote} hint="Optional. When you're usually free, for example weekday evenings, UK time.">
        <Input value={availabilityNote} onChange={(e) => setAvailabilityNote(e.target.value)} maxLength={MENTOR_AVAILABILITY_NOTE_MAX_LENGTH} invalid={!!errors.availabilityNote} autoComplete="off" />
      </FormField>

      <FormField
        label="Note to mentees"
        error={errors.note}
        hint={
          <span className="flex justify-between gap-2">
            <span>Optional. What you can help with, shown on your mentor page.</span>
            <span className="shrink-0 tabular-nums">
              {note.length} / {MENTOR_NOTE_MAX_LENGTH}
            </span>
          </span>
        }
      >
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={5} maxLength={MENTOR_NOTE_MAX_LENGTH} invalid={!!errors.note} />
      </FormField>

      {serverError ? <ErrorBox error={serverError} /> : null}
      <Button type="submit" className="min-h-11" loading={busy}>
        Save mentor profile
      </Button>
    </form>
  );
}
