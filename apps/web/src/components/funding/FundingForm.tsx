import { FUNDING_STAGES, FUNDING_STAGE_LABELS, fundingCreateSchema, type FundingCreateInput, type FundingDto, type FundingKind } from "@illuminize/shared";
import { isApiClientError } from "@illuminize/shared/client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import type { z } from "zod";
import { Button, ErrorBox, FormField, Input, Select, Textarea } from "@/components/ui";

export function FundingForm({ initial, kind, onSubmit, submitLabel }: { initial?: FundingDto; kind: FundingKind; onSubmit: (v: FundingCreateInput) => Promise<void>; submitLabel: string }) {
  const [serverError, setServerError] = useState<unknown>(null);
  const { register, handleSubmit, formState, setError, control } = useForm<z.input<typeof fundingCreateSchema>, unknown, FundingCreateInput>({
    resolver: zodResolver(fundingCreateSchema),
    defaultValues: {
      kind,
      title: initial?.title ?? "",
      stage: initial?.stage ?? (kind === "SEEKING" ? "SEED" : null),
      pitch: initial?.pitch ?? "",
      amountMinMinor: initial?.amountMinMinor ?? null,
      amountMaxMinor: initial?.amountMaxMinor ?? null,
      currency: initial?.currency ?? "INR",
      sectors: initial?.sectors ?? [],
      websiteUrl: initial?.websiteUrl ?? null,
      contactEmail: initial?.contactEmail ?? null,
      contactPhone: initial?.contactPhone ?? null,
    } as z.input<typeof fundingCreateSchema>,
  });
  const e = formState.errors as Record<string, { message?: string } | undefined>;
  const nullable = { setValueAs: (v: string) => (v ? v : null) };
  const money = { setValueAs: (v: string) => (v === "" || v === null ? null : Math.round(Number(v) * 100)) };
  return (
    <form
      className="space-y-4"
      onSubmit={handleSubmit(async (v) => {
        setServerError(null);
        try {
          await onSubmit(v);
        } catch (err) {
          if (isApiClientError(err) && Object.keys(err.fieldErrors).length) {
            for (const [p, m] of Object.entries(err.fieldErrors)) setError(p as "title", { message: m });
          } else setServerError(err);
        }
      })}
    >
      <input type="hidden" {...register("kind")} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <FormField label={kind === "SEEKING" ? "Startup / company name" : "Headline"} required error={e.title?.message}>
            <Input {...register("title")} placeholder={kind === "SEEKING" ? "Acme Labs" : "Angel cheques for alumni founders"} />
          </FormField>
        </div>
        <FormField label={kind === "SEEKING" ? "Stage" : "Preferred stage"} required={kind === "SEEKING"} error={e.stage?.message}>
          <Select {...register("stage", nullable)}>
            {kind === "OFFERING" && <option value="">Any stage</option>}
            {FUNDING_STAGES.map((s) => (
              <option key={s} value={s}>
                {FUNDING_STAGE_LABELS[s]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Currency" error={e.currency?.message}>
          <Select {...register("currency")}>
            {["INR", "USD", "EUR", "GBP", "AED", "SGD"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </FormField>
        <FormField label={kind === "SEEKING" ? "Minimum raise" : "Minimum cheque"} hint="In major units, e.g. 2500000" error={e.amountMinMinor?.message}>
          <Input type="number" min={0} step={1} defaultValue={initial?.amountMinMinor != null ? initial.amountMinMinor / 100 : ""} {...register("amountMinMinor", money)} />
        </FormField>
        <FormField label={kind === "SEEKING" ? "Maximum raise" : "Maximum cheque"} error={e.amountMaxMinor?.message}>
          <Input type="number" min={0} step={1} defaultValue={initial?.amountMaxMinor != null ? initial.amountMaxMinor / 100 : ""} {...register("amountMaxMinor", money)} />
        </FormField>
        <div className="sm:col-span-2">
          <FormField label={kind === "SEEKING" ? "Pitch" : "Investment thesis"} required error={e.pitch?.message}>
            <Textarea {...register("pitch")} rows={6} />
          </FormField>
        </div>
        <FormField label="Sectors" hint="Comma separated" error={e.sectors?.message}>
          <Controller
            control={control}
            name="sectors"
            render={({ field }) => (
              <Input
                value={(field.value ?? []).join(", ")}
                onChange={(ev) =>
                  field.onChange(
                    ev.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean)
                      .slice(0, 10),
                  )
                }
              />
            )}
          />
        </FormField>
        <FormField label="Website" error={e.websiteUrl?.message}>
          <Input {...register("websiteUrl", nullable)} placeholder="https://" />
        </FormField>
        <FormField label="Contact email" error={e.contactEmail?.message}>
          <Input type="email" {...register("contactEmail", nullable)} />
        </FormField>
        <FormField label="Contact phone" error={e.contactPhone?.message}>
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
