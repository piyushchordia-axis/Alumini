import { CAN_REFER_HELP, CAN_REFER_LABEL, JOB_TYPES, JOB_TYPE_LABELS, RICH_TEXT_HINT, WORK_MODES, WORK_MODE_LABELS, jobCreateSchema, waitingReferralsCloseText, type JobCreateInput, type JobDto } from "@illuminize/shared";
import { isApiClientError } from "@illuminize/shared/client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useId, useMemo, useState } from "react";
import { useForm, useWatch, type Resolver } from "react-hook-form";
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

/**
 * Posting or editing a job. `offerReferrals` shows "I can refer people for this job", for a member who can use referrals now;
 * otherwise the job keeps whatever it had, as the API ignores the field then. `waitingReferrals` are the requests waiting
 * for the poster's answer, which unticking it would close.
 */
export function JobForm({
  initial,
  onSubmit,
  submitLabel,
  offerReferrals = false,
  waitingReferrals = 0,
}: {
  initial?: JobDto;
  onSubmit: (v: JobCreateInput) => Promise<void>;
  submitLabel: string;
  offerReferrals?: boolean;
  waitingReferrals?: number;
}) {
  const [serverError, setServerError] = useState<unknown>(null);
  const referId = useId();
  // The form edits the closing date as a calendar date; it becomes an end-of-day instant when validated.
  const resolver = useMemo<Resolver<JobFormValues, unknown, JobCreateInput>>(() => {
    const zod = zodResolver(jobCreateSchema) as unknown as Resolver<JobFormValues, unknown, JobCreateInput>;
    return (values, context, options) => zod({ ...values, expiresAt: values.expiresAt ? endOfLocalDay(values.expiresAt) : null }, context, options);
  }, []);
  const { register, handleSubmit, formState, setError, control } = useForm<JobFormValues, unknown, JobCreateInput>({
    resolver,
    defaultValues: {
      title: initial?.title ?? "",
      companyName: initial?.companyName ?? "",
      location: initial?.location ?? null,
      workMode: initial?.workMode ?? "ON_SITE",
      jobType: initial?.jobType ?? "FULL_TIME",
      description: initial?.description ?? "",
      applyUrl: initial?.applyUrl ?? null,
      contactEmail: initial?.contactEmail ?? null,
      contactPhone: initial?.contactPhone ?? null,
      salaryNote: initial?.salaryNote ?? null,
      expiresAt: toLocalDate(initial?.expiresAt),
      canRefer: initial?.canRefer ?? false,
    },
  });
  const e = formState.errors;
  const nullable = { setValueAs: (v: string) => (v ? v : null) };
  const offered = useWatch({ control, name: "canRefer" });
  const closesWaiting = offerReferrals && !!initial?.canRefer && waitingReferrals > 0 && !offered;
  return (
    <form
      className="space-y-4"
      onSubmit={handleSubmit(async (v) => {
        setServerError(null);
        try {
          // Left out unless it was offered, so an edit never changes what the poster couldn't see, and on an edit unless they
          // changed it: a copy of the job read while referrals were off says false, which saving mustn't store.
          const sendRefer = offerReferrals && (!initial || v.canRefer !== initial.canRefer);
          await onSubmit(sendRefer ? v : { ...v, canRefer: undefined });
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
        <FormField label="Work mode" error={e.workMode?.message}>
          <Select {...register("workMode")}>
            {WORK_MODES.map((m) => (
              <option key={m} value={m}>
                {WORK_MODE_LABELS[m]}
              </option>
            ))}
          </Select>
        </FormField>
        <div className="sm:col-span-2">
          <FormField label="Description" required error={e.description?.message} hint={RICH_TEXT_HINT}>
            <Textarea {...register("description")} rows={6} invalid={!!e.description} placeholder="Role, requirements, how to apply" />
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
        <FormField label="Pay note" error={e.salaryNote?.message}>
          <Input {...register("salaryNote", nullable)} placeholder="e.g. ₹18–25 LPA plus ESOPs" />
        </FormField>
        <FormField label="Applications close" hint="Optional. The job is hidden from the board after this day." error={e.expiresAt?.message}>
          <Input type="date" min={toLocalDate(new Date().toISOString()) ?? undefined} {...register("expiresAt", nullable)} />
        </FormField>
        {offerReferrals && (
          <div className="rounded-lg border border-slate-200 px-3 py-1 sm:col-span-2">
            <Checkbox {...register("canRefer")} label={CAN_REFER_LABEL} aria-describedby={`${referId}-help${closesWaiting ? ` ${referId}-closes` : ""}`} className="min-h-11 font-medium" />
            <p id={`${referId}-help`} className="pb-2 text-xs text-slate-500">
              {CAN_REFER_HELP}
            </p>
            {closesWaiting && (
              // Said as it appears, as on the mobile app: unticking is what brings it up.
              <p id={`${referId}-closes`} role="alert" className="pb-2 text-xs text-amber-800">
                {waitingReferralsCloseText(waitingReferrals)}
              </p>
            )}
          </div>
        )}
      </div>
      {serverError ? <ErrorBox error={serverError} /> : null}
      <Button type="submit" loading={formState.isSubmitting}>
        {submitLabel}
      </Button>
    </form>
  );
}
