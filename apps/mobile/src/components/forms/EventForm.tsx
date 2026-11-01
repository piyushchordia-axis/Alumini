import {
  COMMON_TIME_ZONES,
  EVENT_KINDS,
  EVENT_KIND_LABELS,
  eventCreateSchema,
  eventEditSchema,
  localTimeZone,
  utcToZonedWallTime,
  zonedWallTimeToUtc,
  zoneOffsetLabel,
  type EventCreateInput,
  type EventDto,
  type EventKind,
} from "@illuminize/shared";
import { errorMessage, isApiClientError } from "@illuminize/shared/client";
import { useMemo, useState } from "react";
import { DateTimeField } from "@/components/DateTimeField";
import { Button, ChipSelect, ErrorText, Input, Row } from "@/components/ui";
import { useImageUpload } from "@/hooks/useImagePicker";

/**
 * Create / edit form for events. Start and end are picked as clock times in the event's
 * time zone and converted to instants on submit, so they are right even when the
 * organiser's phone is set to a different zone.
 */
export function EventForm({
  slug,
  defaultCity,
  initial,
  submitLabel,
  onSubmit,
  tenantZone,
}: {
  slug: string;
  defaultCity?: string | null;
  initial?: EventDto;
  submitLabel: string;
  onSubmit: (v: EventCreateInput) => Promise<void>;
  /** The institution's time zone, offered next to the phone's. */
  tenantZone?: string;
}) {
  const deviceTz = localTimeZone();
  const initialZone = initial?.timezone ?? deviceTz;
  const tzOptions = useMemo(() => [...new Set<string>([initialZone, deviceTz, ...(tenantZone ? [tenantZone] : []), ...COMMON_TIME_ZONES])], [initialZone, deviceTz, tenantZone]);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [kind, setKind] = useState<EventKind | "">(initial?.kind ?? "CASUAL_MEETUP");
  const [city, setCity] = useState(initial?.city ?? defaultCity ?? "");
  const [venueName, setVenueName] = useState(initial?.venueName ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [timezone, setTimezone] = useState<string>(initialZone);
  const [start, setStart] = useState<string | null>(initial ? utcToZonedWallTime(initial.startAt, initialZone) : null);
  const [end, setEnd] = useState<string | null>(initial?.endAt ? utcToZonedWallTime(initial.endAt, initialZone) : null);
  const [maxAttendees, setMaxAttendees] = useState(initial?.maxAttendees ? String(initial.maxAttendees) : "");
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(initial?.coverImageUrl ?? null);
  const upload = useImageUpload(slug);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nul = (s: string) => (s.trim() ? s.trim() : null);
  const zoneLabel = `${timezone.replace(/_/g, " ")}`;

  const submit = async () => {
    setErrors({});
    setServerError(null);
    if (!start) return setErrors({ startAt: "Choose when it starts" });
    const startAt = zonedWallTimeToUtc(start, timezone);
    const endAt = end ? zonedWallTimeToUtc(end, timezone) : null;
    const schema = initial ? eventEditSchema(initial.startAt) : eventCreateSchema;
    const parsed = schema.safeParse({ title, description, kind, city, venueName: nul(venueName), address: nul(address), startAt, endAt, timezone, maxAttendees: maxAttendees.trim() ? Number(maxAttendees) : null, coverImageUrl });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const i of parsed.error.issues) next[String(i.path[0])] ??= i.message;
      setErrors(next);
      return;
    }
    setBusy(true);
    try {
      await onSubmit(parsed.data);
    } catch (err) {
      if (isApiClientError(err) && Object.keys(err.fieldErrors).length) setErrors(err.fieldErrors);
      else setServerError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Input label="Title *" value={title} onChangeText={setTitle} placeholder="Mumbai alumni coffee meetup" error={errors.title} />
      <ChipSelect label="Type *" options={EVENT_KINDS.map((k) => ({ value: k, label: EVENT_KIND_LABELS[k] }))} value={kind} onChange={setKind} />
      <Input label="City *" value={city} onChangeText={setCity} error={errors.city} />
      <ChipSelect label="Time zone" options={tzOptions.map((t) => ({ value: t, label: `${t.replace(/_/g, " ")} (${zoneOffsetLabel(t)})` }))} value={timezone} onChange={(v) => v && setTimezone(v)} />
      <DateTimeField label={`Starts * (${zoneLabel})`} value={start} onChange={setStart} error={errors.startAt} />
      <DateTimeField label={`Ends (${zoneLabel})`} value={end} onChange={setEnd} error={errors.endAt} clearable />
      <Input label="Max attendees" value={maxAttendees} onChangeText={(v) => setMaxAttendees(v.replace(/\D/g, ""))} keyboardType="number-pad" hint="Leave blank for unlimited" error={errors.maxAttendees} />
      <Input label="Venue" value={venueName} onChangeText={setVenueName} placeholder="Café, hall, link for online" error={errors.venueName} />
      <Input label="Address" value={address} onChangeText={setAddress} error={errors.address} />
      <Input label="Details *" value={description} onChangeText={setDescription} multiline placeholder="What's the plan? Who should come?" error={errors.description} />
      <Row>
        <Button
          title={coverImageUrl ? "Change cover image" : "📷 Cover image"}
          variant="outline"
          loading={upload.busy}
          onPress={async () => {
            const url = await upload.pickAndUpload();
            if (url) setCoverImageUrl(url);
          }}
        />
        {coverImageUrl && <Button title="Remove cover" variant="ghost" onPress={() => setCoverImageUrl(null)} />}
      </Row>
      <ErrorText error={serverError} />
      <Button title={submitLabel} onPress={() => void submit()} loading={busy} />
    </>
  );
}
