import {
  COMMON_TIME_ZONES,
  EVENT_KINDS,
  EVENT_KIND_LABELS,
  RICH_TEXT_HINT,
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
import { isApiClientError } from "@illuminize/shared/client";
import { useMemo, useState } from "react";
import { Controller, useForm, useWatch, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ImageUploader } from "@/components/common/ImageUploader";
import { Button, ErrorBox, FormField, Input, Select, Textarea } from "@/components/ui";

/**
 * The form holds start/end as wall-clock times ("YYYY-MM-DDTHH:mm") in the event's own time zone,
 * which is what <input type="datetime-local"> edits. They are converted to UTC instants with the
 * selected zone only when the form is validated, so changing the zone after typing a time keeps
 * the clock time the organiser typed.
 */
interface EventFormValues {
  title: string;
  description: string;
  kind: EventKind;
  city: string;
  venueName: string | null;
  address: string | null;
  startAt: string;
  endAt: string | null;
  timezone: string;
  maxAttendees: number | null;
  coverImageUrl: string | null;
}

export function EventForm({
  slug,
  initial,
  onSubmit,
  submitLabel,
  tenantZone,
}: {
  slug: string;
  initial?: EventDto;
  onSubmit: (v: EventCreateInput) => Promise<void>;
  submitLabel: string;
  /** The institution's time zone, offered next to the device's. */
  tenantZone?: string;
}) {
  const [serverError, setServerError] = useState<unknown>(null);
  const initialZone = initial?.timezone ?? localTimeZone();
  const tzOptions = useMemo(() => [...new Set<string>([initialZone, localTimeZone(), ...(tenantZone ? [tenantZone] : []), ...COMMON_TIME_ZONES])], [initialZone, tenantZone]);

  // Convert wall times to instants with the chosen zone, then validate with the shared schema.
  const resolver = useMemo<Resolver<EventFormValues, unknown, EventCreateInput>>(() => {
    const schema = initial ? eventEditSchema(initial.startAt) : eventCreateSchema;
    const zod = zodResolver(schema) as unknown as Resolver<Record<string, unknown>, unknown, EventCreateInput>;
    return (values, context, options) => {
      const startAt = values.startAt ? zonedWallTimeToUtc(values.startAt, values.timezone) : null;
      const endAt = values.endAt ? zonedWallTimeToUtc(values.endAt, values.timezone) : null;
      return zod({ ...values, startAt: startAt ?? "", endAt: values.endAt ? (endAt ?? "invalid") : null }, context, options as never) as never;
    };
  }, [initial]);

  const { register, handleSubmit, formState, setError, control } = useForm<EventFormValues, unknown, EventCreateInput>({
    resolver,
    defaultValues: {
      title: initial?.title ?? "",
      description: initial?.description ?? "",
      kind: initial?.kind ?? "CASUAL_MEETUP",
      city: initial?.city ?? "",
      venueName: initial?.venueName ?? null,
      address: initial?.address ?? null,
      startAt: initial ? utcToZonedWallTime(initial.startAt, initialZone) : "",
      endAt: initial?.endAt ? utcToZonedWallTime(initial.endAt, initialZone) : null,
      timezone: initialZone,
      maxAttendees: initial?.maxAttendees ?? null,
      coverImageUrl: initial?.coverImageUrl ?? null,
    },
  });
  const zone = useWatch({ control, name: "timezone" });
  const e = formState.errors;
  const nullable = { setValueAs: (v: string) => (v ? v : null) };
  return (
    <form
      className="space-y-4"
      onSubmit={handleSubmit(async (v) => {
        setServerError(null);
        try {
          await onSubmit(v);
        } catch (err) {
          if (isApiClientError(err) && Object.keys(err.fieldErrors).length) {
            for (const [p, m] of Object.entries(err.fieldErrors)) setError(p as keyof EventFormValues, { message: m });
          } else setServerError(err);
        }
      })}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <FormField label="Title" required error={e.title?.message}>
            <Input {...register("title")} placeholder="Mumbai alumni coffee meetup" />
          </FormField>
        </div>
        <FormField label="Type" required error={e.kind?.message}>
          <Select {...register("kind")}>
            {EVENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {EVENT_KIND_LABELS[k]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="City" required error={e.city?.message}>
          <Input {...register("city")} />
        </FormField>
        <FormField label="Time zone" required error={e.timezone?.message} hint="Start and end times are in this time zone.">
          <Select {...register("timezone")}>
            {tzOptions.map((tz) => (
              <option key={tz} value={tz}>
                {tz.replace(/_/g, " ")} ({zoneOffsetLabel(tz)})
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Max attendees" hint="Leave blank for unlimited" error={e.maxAttendees?.message}>
          <Input type="number" min={1} {...register("maxAttendees", { setValueAs: (v) => (v === "" || v === null ? null : Number(v)) })} />
        </FormField>
        <FormField label={`Starts (${zone.replace(/_/g, " ")})`} required error={e.startAt?.message}>
          <Input type="datetime-local" {...register("startAt")} />
        </FormField>
        <FormField label={`Ends (${zone.replace(/_/g, " ")})`} error={e.endAt?.message}>
          <Input type="datetime-local" {...register("endAt", nullable)} />
        </FormField>
        <FormField label="Venue" error={e.venueName?.message}>
          <Input {...register("venueName", nullable)} placeholder="Café, hall, link for online" />
        </FormField>
        <FormField label="Address" error={e.address?.message}>
          <Input {...register("address", nullable)} />
        </FormField>
        <div className="sm:col-span-2">
          <FormField label="Details" required error={e.description?.message} hint={RICH_TEXT_HINT}>
            <Textarea {...register("description")} rows={5} placeholder="What's the plan? Who should come?" />
          </FormField>
        </div>
        <div className="sm:col-span-2">
          <Controller control={control} name="coverImageUrl" render={({ field }) => <ImageUploader slug={slug} urls={field.value ? [field.value] : []} onChange={(u) => field.onChange(u[0] ?? null)} label="Cover image" />} />
        </div>
      </div>
      {serverError ? <ErrorBox error={serverError} /> : null}
      <Button type="submit" loading={formState.isSubmitting}>
        {submitLabel}
      </Button>
    </form>
  );
}
