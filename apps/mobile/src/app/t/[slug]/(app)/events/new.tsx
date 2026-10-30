import { EVENT_KINDS, EVENT_KIND_LABELS, eventCreateSchema, type EventKind } from "@illuminize/shared";
import { errorMessage, isApiClientError } from "@illuminize/shared/client";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert } from "react-native";
import { Button, ChipSelect, ErrorText, Input, Row, Screen } from "@/components/ui";
import { useImageUpload } from "@/hooks/useImagePicker";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";

const TZ = ["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Europe/London", "Europe/Berlin", "America/New_York", "America/Los_Angeles", "America/Toronto", "Australia/Sydney", "UTC"];

/** Parses "YYYY-MM-DD HH:mm" typed by the user as local time into an ISO instant. */
function parseLocal(v: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export default function NewEventScreen() {
  const { tenant } = useMembership();
  const router = useRouter();
  const qc = useQueryClient();
  const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const tzOptions = TZ.includes(deviceTz) ? TZ : [deviceTz, ...TZ];
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<EventKind | "">("CASUAL_MEETUP");
  const [city, setCity] = useState(tenant.city ?? "");
  const [venueName, setVenueName] = useState("");
  const [address, setAddress] = useState("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [timezone, setTimezone] = useState<string>(deviceTz);
  const [maxAttendees, setMaxAttendees] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(null);
  const upload = useImageUpload(tenant.slug);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nul = (s: string) => (s.trim() ? s.trim() : null);
  const submit = async () => {
    setErrors({});
    setServerError(null);
    const start = parseLocal(startAt);
    if (!start) return setErrors({ startAt: "Use the format YYYY-MM-DD HH:mm" });
    const end = endAt.trim() ? parseLocal(endAt) : null;
    if (endAt.trim() && !end) return setErrors({ endAt: "Use the format YYYY-MM-DD HH:mm" });
    const parsed = eventCreateSchema.safeParse({ title, description, kind, city, venueName: nul(venueName), address: nul(address), startAt: start, endAt: end, timezone, maxAttendees: maxAttendees.trim() ? Number(maxAttendees) : null, coverImageUrl });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const i of parsed.error.issues) next[String(i.path[0])] ??= i.message;
      setErrors(next);
      return;
    }
    setBusy(true);
    try {
      const ev = await api.events.create(tenant.slug, parsed.data);
      void qc.invalidateQueries({ queryKey: ["events", tenant.slug] });
      Alert.alert(ev.moderationStatus === "PENDING" ? "Submitted — awaiting admin approval" : "Event published");
      router.replace(`/t/${tenant.slug}/events/${ev.id}`);
    } catch (err) {
      if (isApiClientError(err) && Object.keys(err.fieldErrors).length) setErrors(err.fieldErrors);
      else setServerError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen>
      <Input label="Title *" value={title} onChangeText={setTitle} placeholder="Mumbai alumni coffee meetup" error={errors.title} />
      <ChipSelect label="Type *" options={EVENT_KINDS.map((k) => ({ value: k, label: EVENT_KIND_LABELS[k] }))} value={kind} onChange={setKind} />
      <Input label="City *" value={city} onChangeText={setCity} error={errors.city} />
      <Input label="Starts * (YYYY-MM-DD HH:mm)" value={startAt} onChangeText={setStartAt} placeholder="2026-12-14 18:30" error={errors.startAt} />
      <Input label="Ends (YYYY-MM-DD HH:mm)" value={endAt} onChangeText={setEndAt} error={errors.endAt} />
      <ChipSelect label="Time zone" options={tzOptions.map((t) => ({ value: t, label: t }))} value={timezone} onChange={(v) => v && setTimezone(v)} />
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
      </Row>
      <ErrorText error={serverError} />
      <Button title="Publish event" onPress={() => void submit()} loading={busy} />
    </Screen>
  );
}
