import {
  MARITAL_STATUSES,
  MARITAL_STATUS_LABELS,
  PROFESSION_TYPES,
  PROFESSION_TYPE_LABELS,
  membershipProfileSchema,
  validateProfileFieldValues,
  type MembershipDto,
  type MembershipProfileInput,
  type ProfileFieldDto,
  type TenantPublicDto,
} from "@illuminize/shared";
import { isApiClientError } from "@illuminize/shared/client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { CountrySelect } from "@/components/common/CountrySelect";
import { CommaListInput } from "@/components/common/CommaListInput";
import { ImageUploader } from "@/components/common/ImageUploader";
import { CustomFieldInputs, answersToValues, type FieldAnswers } from "@/components/profile/CustomFieldInputs";
import { Button, Checkbox, ErrorBox, FormField, Input, Select, Textarea } from "@/components/ui";

export interface ProfileFormProps {
  tenant: TenantPublicDto;
  initial?: Partial<MembershipDto>;
  submitLabel: string;
  onSubmit: (values: MembershipProfileInput) => Promise<void>;
  /** The institution's own questions (from api.membership.profileFields). */
  customFields?: ProfileFieldDto[];
  /** Registration asks every required question; later edits only refuse clearing one. */
  mode?: "register" | "edit";
}

const toForm = (m?: Partial<MembershipDto>): MembershipProfileInput => ({
  fullName: m?.fullName ?? "",
  batchYear: m?.batchYear ?? new Date().getFullYear() - 5,
  dateOfBirth: m?.dateOfBirth ?? null,
  professionType: m?.professionType ?? "EMPLOYED",
  companyName: m?.companyName ?? null,
  designation: m?.designation ?? null,
  city: m?.city ?? null,
  country: m?.country ?? "IN",
  maritalStatus: m?.maritalStatus ?? null,
  kidsCount: m?.kidsCount ?? null,
  bio: m?.bio ?? null,
  linkedinUrl: m?.linkedinUrl ?? null,
  interests: m?.interests ?? [],
  avatarUrl: m?.avatarUrl ?? null,
  isPhoneVisible: m?.isPhoneVisible ?? false,
});

export function ProfileForm({ tenant, initial, submitLabel, onSubmit, customFields = [], mode = "edit" }: ProfileFormProps) {
  const [serverError, setServerError] = useState<unknown>(null);
  const initialAnswers = answersToValues(initial?.fields);
  const [answers, setAnswers] = useState<FieldAnswers>(initialAnswers);
  const [answerErrors, setAnswerErrors] = useState<Record<string, string>>({});
  const readOnly = (f: { memberEditable: boolean }) => !f.memberEditable;
  const required = customFields.filter((f) => f.required && !readOnly(f));
  const optional = customFields.filter((f) => !f.required || readOnly(f));
  const setAnswer = (key: string, value: FieldAnswers[string]) => {
    setAnswers((a) => ({ ...a, [key]: value }));
    setAnswerErrors((e) => ({ ...e, [key]: "" }));
  };
  type FormInput = z.input<typeof membershipProfileSchema>;
  const form = useForm<FormInput, unknown, MembershipProfileInput>({ resolver: zodResolver(membershipProfileSchema), defaultValues: toForm(initial) });
  const { register, handleSubmit, control, formState, setError } = form;
  const errors = formState.errors;
  const years: number[] = [];
  for (let y = tenant.settings.maxBatchYear; y >= tenant.settings.minBatchYear; y--) years.push(y);
  const profession = useWatch({ control, name: "professionType" });

  const submit = handleSubmit(async (values) => {
    setServerError(null);
    // Only send answers the member can change; check them here first for instant feedback.
    const editable = Object.fromEntries(customFields.filter((f) => !readOnly(f)).map((f) => [f.key, answers[f.key] ?? null]));
    const check = validateProfileFieldValues(customFields, editable, { requireAll: mode === "register", previous: initialAnswers, canEdit: (f) => !readOnly(f) });
    if (Object.keys(check.errors).length) {
      setAnswerErrors(check.errors);
      return;
    }
    try {
      await onSubmit(customFields.length ? { ...values, fields: editable } : values);
    } catch (err) {
      if (isApiClientError(err)) {
        const fields = err.fieldErrors;
        const fromServer: Record<string, string> = {};
        for (const [path, message] of Object.entries(fields)) {
          if (path.startsWith("fields.")) fromServer[path.slice(7)] = message;
          else setError(path as keyof FormInput, { message });
        }
        setAnswerErrors(fromServer);
        if (Object.keys(fields).length === 0) setServerError(err);
      } else setServerError(err);
    }
  });

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="flex items-center gap-4">
        <Controller control={control} name="avatarUrl" render={({ field }) => <ImageUploader slug={tenant.slug} urls={field.value ? [field.value] : []} onChange={(u) => field.onChange(u[0] ?? null)} label="Photo" />} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Full name" required error={errors.fullName?.message}>
          <Input {...register("fullName")} invalid={!!errors.fullName} autoComplete="name" />
        </FormField>
        <FormField label="Batch (year of passing out)" required error={errors.batchYear?.message}>
          <Select {...register("batchYear", { valueAsNumber: true })} invalid={!!errors.batchYear}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Date of birth" error={errors.dateOfBirth?.message}>
          <Input type="date" {...register("dateOfBirth", { setValueAs: (v) => (v ? v : null) })} invalid={!!errors.dateOfBirth} />
        </FormField>
        <FormField label="What do you do?" required error={errors.professionType?.message}>
          <Select {...register("professionType")}>
            {PROFESSION_TYPES.map((p) => (
              <option key={p} value={p}>
                {PROFESSION_TYPE_LABELS[p]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={profession === "STUDENT" ? "Institution" : profession === "EMPLOYED" ? "Company" : "Company / business"} error={errors.companyName?.message}>
          <Input {...register("companyName")} placeholder={profession === "FOUNDER" ? "Your startup" : "Where you work"} />
        </FormField>
        <FormField label="Designation / role" error={errors.designation?.message}>
          <Input {...register("designation")} />
        </FormField>
        <FormField label="Current city" error={errors.city?.message}>
          <Input {...register("city")} autoComplete="address-level2" />
        </FormField>
        <FormField label="Country" error={errors.country?.message}>
          <CountrySelect {...register("country", { setValueAs: (v) => (v ? v : null) })} />
        </FormField>
        <CustomFieldInputs fields={required} values={answers} errors={answerErrors} onChange={setAnswer} />
      </div>

      <details className="rounded-lg border border-slate-200 p-4" open={!!initial?.bio || !!initial?.linkedinUrl || Object.values(answerErrors).some(Boolean)}>
        <summary className="cursor-pointer text-sm font-medium text-slate-700">More about you (optional)</summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <FormField label="Marital status" error={errors.maritalStatus?.message}>
            <Select {...register("maritalStatus", { setValueAs: (v) => (v ? v : null) })}>
              <option value="">Prefer not to say</option>
              {MARITAL_STATUSES.map((m) => (
                <option key={m} value={m}>
                  {MARITAL_STATUS_LABELS[m]}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Number of kids" error={errors.kidsCount?.message}>
            <Input type="number" min={0} max={20} {...register("kidsCount", { setValueAs: (v) => (v === "" || v === null ? null : Number(v)) })} />
          </FormField>
          <FormField label="LinkedIn profile" error={errors.linkedinUrl?.message}>
            <Input {...register("linkedinUrl", { setValueAs: (v) => (v ? v : null) })} placeholder="https://www.linkedin.com/in/…" />
          </FormField>
          <FormField label="Interests" hint="Comma separated, e.g. cricket, startups, travel" error={errors.interests?.message}>
            <Controller
              control={control}
              name="interests"
              render={({ field }) => <CommaListInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} max={20} placeholder="cricket, startups, travel" />}
            />
          </FormField>
          <div className="sm:col-span-2">
            <FormField label="Short bio" error={errors.bio?.message}>
              <Textarea {...register("bio")} placeholder="Tell your batchmates what you're up to" maxLength={1000} />
            </FormField>
          </div>
          <CustomFieldInputs fields={optional} values={answers} errors={answerErrors} onChange={setAnswer} readOnly={readOnly} />
          <div className="sm:col-span-2">
            <Checkbox {...register("isPhoneVisible")} label="Show my phone number to other members in the directory" />
          </div>
        </div>
      </details>

      {serverError ? <ErrorBox error={serverError} /> : null}
      <Button type="submit" block loading={formState.isSubmitting}>
        {submitLabel}
      </Button>
    </form>
  );
}
