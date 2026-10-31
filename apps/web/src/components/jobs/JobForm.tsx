import { JOB_TYPES, JOB_TYPE_LABELS, jobCreateSchema, type JobCreateInput, type JobDto } from "@illuminize/shared";
import { isApiClientError } from "@illuminize/shared/client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import type { z } from "zod";
import { Button, Checkbox, ErrorBox, FormField, Input, Select, Textarea } from "@/components/ui";

type JobFormValues = z.input<typeof jobCreateSchema>;

/** "YYYY-MM-DD" in the viewer's zone for an instant, for <input type="date">. */
function toLocalDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The closing date means "open until the end of that day" where the poster is. */
function endOfLocalDay(date: string): string {
  const d = new Date(`${date}T23:59:59`);
  return Number.isNaN(d.getTime()) ? date : d.toISOString();
}

export function JobForm({ initial, onSubmit, submitLabel }: { initial?: JobDto; onSubmit: (v: JobCreateInput) => Promise<void>; submitLabel: string }) {
  const [serverError, setServerError] = useState<unknown>(null);
  // The form edits the closing date as a calendar date; it becomes an end-of-day instant when validated.
  const resolver = useMemo<Resolver<JobFormValues, unknown, JobCreateInput>>(() => {
    const zod = zodResolver(jobCreateSchema) as unknown as Resolver<JobFormValues, unknown, JobCreateInput>;
    return (values, context, options) => zod({ ...values, expiresAt: values.expiresAt ? endOfLocalDay(values.expiresAt) : null }, context, options);
  }, []);
  const { register, handleSubmit, formState, setError } = useForm<JobFormValues, unknown, JobCreateInput>({
    resolver,
    defaultValues: {
      title: initial?.title ?? "",
      companyName: initial?.companyName ?? "",
      location: initial?.location ?? null,
      isRemote: initial?.isRemote ?? false,
      jobType: initial?.jobType ?? "FULL_TIME",
      description: initial?.description ?? "",
      applyUrl: initial?.applyUrl ?? null,
      contactEmail: initial?.contactEmail ?? null,
      contactPhone: initial?.contactPhone ?? null,
      salaryRange: initial?.salaryRange ?? null,
      expiresAt: toLocalDate(initial?.expiresAt),
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
            for (const [p, m] of Object.entries(err.fieldErrors)) setError(p as keyof z.input<typeof jobCreateSchema>, { message: m });
          } else setServerError(err);
        }
      })}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <FormField label="Job title" required error={e.title?.message}>
            <Input {...register("title")} invalid={!!e.title} />
          </FormField>
        </div>
        <FormField label="Company" required error={e.companyName?.message}>
          <Input {...register("companyName")} invalid={!!e.companyName} />
        </FormField>
        <FormField label="Type" required error={e.jobType?.message}>
          <Select {...register("jobType")}>
            {JOB_TYPES.map((t) => (
              <option key={t} value={t}>
                {JOB_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Location" error={e.location?.message}>
          <Input {...register("location", nullable)} placeholder="City, country" />
        </FormField>
        <div className="flex items-end pb-2">
          <Checkbox {...register("isRemote")} label="Remote friendly" />
        </div>
        <div className="sm:col-span-2">
          <FormField label="Description" required error={e.description?.message} hint="Role, requirements, how to apply.">
            <Textarea {...register("description")} rows={6} invalid={!!e.description} />
          </FormField>
        </div>
        <FormField label="Apply link" error={e.applyUrl?.message}>
          <Input {...register("applyUrl", nullable)} placeholder="https://" />
        </FormField>
        <FormField label="Contact email" error={e.contactEmail?.message}>
          <Input type="email" {...register("contactEmail", nullable)} />
        </FormField>
        <FormField label="Contact phone" error={e.contactPhone?.message}>
          <Input {...register("contactPhone", nullable)} />
        </FormField>
        <FormField label="Salary range" error={e.salaryRange?.message}>
          <Input {...register("salaryRange", nullable)} placeholder="e.g. ₹18–25 LPA" />
        </FormField>
        <FormField label="Applications close" hint="Optional. The job is hidden from the board after this day." error={e.expiresAt?.message}>
          <Input type="date" min={toLocalDate(new Date().toISOString()) ?? undefined} {...register("expiresAt", nullable)} />
        </FormField>
      </div>
      {serverError ? <ErrorBox error={serverError} /> : null}
      <Button type="submit" loading={formState.isSubmitting}>
        {submitLabel}
      </Button>
    </form>
  );
}
