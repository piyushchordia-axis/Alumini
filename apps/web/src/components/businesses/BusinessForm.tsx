import { BUSINESS_CATEGORIES, BUSINESS_CATEGORY_LABELS, businessCreateSchema, type BusinessCreateInput, type BusinessDto } from "@illuminize/shared";
import { isApiClientError } from "@illuminize/shared/client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import type { z } from "zod";
import { ImageUploader } from "@/components/common/ImageUploader";
import { Button, ErrorBox, FormField, Input, Select, Textarea } from "@/components/ui";

type BusinessFormValues = z.input<typeof businessCreateSchema>;

export function BusinessForm({ slug, initial, onSubmit, submitLabel }: { slug: string; initial?: BusinessDto; onSubmit: (v: BusinessCreateInput) => Promise<void>; submitLabel: string }) {
  const [serverError, setServerError] = useState<unknown>(null);
  const { register, control, handleSubmit, formState, setError } = useForm<BusinessFormValues, unknown, BusinessCreateInput>({
    resolver: zodResolver(businessCreateSchema),
    defaultValues: {
      name: initial?.name ?? "",
      // Nothing chosen to start with: a preselected "Other" would quietly fill the filter with listings nobody can find.
      category: initial?.category ?? ("" as BusinessFormValues["category"]),
      description: initial?.description ?? "",
      logoUrl: initial?.logoUrl ?? null,
      city: initial?.city ?? null,
      websiteUrl: initial?.websiteUrl ?? null,
      contactEmail: initial?.contactEmail ?? null,
      contactPhone: initial?.contactPhone ?? null,
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
            for (const [p, m] of Object.entries(err.fieldErrors)) setError(p as keyof BusinessFormValues, { message: m });
          } else setServerError(err);
        }
      })}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <FormField label="Business name" required error={e.name?.message}>
            <Input {...register("name")} invalid={!!e.name} />
          </FormField>
        </div>
        <FormField label="Category" required error={e.category?.message}>
          <Select {...register("category")} invalid={!!e.category}>
            <option value="">Choose a category</option>
            {BUSINESS_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {BUSINESS_CATEGORY_LABELS[c]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="City" error={e.city?.message}>
          <Input {...register("city", nullable)} />
        </FormField>
        <div className="sm:col-span-2">
          <FormField label="Description" required error={e.description?.message} hint="What you do, and anything alumni should know.">
            <Textarea {...register("description")} rows={5} invalid={!!e.description} />
          </FormField>
        </div>
        <div className="sm:col-span-2">
          <FormField label="Logo" group error={e.logoUrl?.message}>
            <Controller control={control} name="logoUrl" render={({ field }) => <ImageUploader slug={slug} urls={field.value ? [field.value] : []} onChange={(u) => field.onChange(u[0] ?? null)} label="Add logo" removeLabel="Remove logo" />} />
          </FormField>
        </div>
        <FormField label="Website" error={e.websiteUrl?.message}>
          <Input {...register("websiteUrl", nullable)} placeholder="https://" />
        </FormField>
        <FormField label="Contact email" error={e.contactEmail?.message} hint="Shown on this listing's page, not in the list.">
          <Input type="email" {...register("contactEmail", nullable)} />
        </FormField>
        <FormField label="Contact phone" error={e.contactPhone?.message} hint="Shown on this listing's page, not in the list.">
          <Input {...register("contactPhone", nullable)} />
        </FormField>
      </div>
      {serverError ? <ErrorBox error={serverError} /> : null}
      <Button type="submit" loading={formState.isSubmitting}>
        {submitLabel}
      </Button>
    </form>
  );
}
