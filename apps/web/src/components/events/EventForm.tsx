import { EVENT_KINDS, EVENT_KIND_LABELS, eventCreateSchema, type EventCreateInput, type EventDto } from "@illuminize/shared";
import { isApiClientError } from "@illuminize/shared/client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import type { z } from "zod";
import { ImageUploader } from "@/components/common/ImageUploader";
import { Button, ErrorBox, FormField, Input, Select, Textarea } from "@/components/ui";

const COMMON_TZ = ["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Europe/London", "Europe/Berlin", "America/New_York", "America/Los_Angeles", "America/Toronto", "Australia/Sydney", "UTC"];

/** <input type="datetime-local"> works in the browser's local wall time; values are stored as ISO instants. */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const fromLocalInput = (v: string): string | null => (v ? new Date(v).toISOString() : null);

export function EventForm({ slug, initial, onSubmit, submitLabel }: { slug: string; initial?: EventDto; onSubmit: (v: EventCreateInput) => Promise<void>; submitLabel: string }) {
  const [serverError, setServerError] = useState<unknown>(null);
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const tzOptions = COMMON_TZ.includes(browserTz) ? COMMON_TZ : [browserTz, ...COMMON_TZ];
  const { register, handleSubmit, formState, setError, control } = useForm<z.input<typeof eventCreateSchema>, unknown, EventCreateInput>({
    resolver: zodResolver(eventCreateSchema),
    defaultValues: {
      title: initial?.title ?? "",
      description: initial?.description ?? "",
      kind: initial?.kind ?? "CASUAL_MEETUP",
      city: initial?.city ?? "",
      venueName: initial?.venueName ?? null,
      address: initial?.address ?? null,
      startAt: initial?.startAt ?? "",
      endAt: initial?.endAt ?? null,
      timezone: initial?.timezone ?? browserTz,
      maxAttendees: initial?.maxAttendees ?? null,
      coverImageUrl: initial?.coverImageUrl ?? null,
    },
  });
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
            for (const [p, m] of Object.entries(err.fieldErrors)) setError(p as keyof z.input<typeof eventCreateSchema>, { message: m });
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
        <FormField label="Starts" required error={e.startAt?.message}>
          <Controller control={control} name="startAt" render={({ field }) => <Input type="datetime-local" value={toLocalInput(field.value)} onChange={(ev) => field.onChange(fromLocalInput(ev.target.value) ?? "")} />} />
        </FormField>
        <FormField label="Ends" error={e.endAt?.message}>
          <Controller control={control} name="endAt" render={({ field }) => <Input type="datetime-local" value={toLocalInput(field.value)} onChange={(ev) => field.onChange(fromLocalInput(ev.target.value))} />} />
        </FormField>
        <FormField label="Time zone" required error={e.timezone?.message}>
          <Select {...register("timezone")}>
            {tzOptions.map((tz) => (
              <option key={tz}>{tz}</option>
            ))}
          </Select>
        </FormField>
        <FormField label="Max attendees" hint="Leave blank for unlimited" error={e.maxAttendees?.message}>
          <Input type="number" min={1} {...register("maxAttendees", { setValueAs: (v) => (v === "" || v === null ? null : Number(v)) })} />
        </FormField>
        <FormField label="Venue" error={e.venueName?.message}>
          <Input {...register("venueName", nullable)} placeholder="Café, hall, link for online" />
        </FormField>
        <FormField label="Address" error={e.address?.message}>
          <Input {...register("address", nullable)} />
        </FormField>
        <div className="sm:col-span-2">
          <FormField label="Details" required error={e.description?.message}>
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
