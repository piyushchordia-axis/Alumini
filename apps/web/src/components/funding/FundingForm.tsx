import { FUNDING_STAGES, FUNDING_STAGE_LABELS, fundingCreateSchema, type FundingCreateInput, type FundingDto, type FundingKind, type FundingStage } from "@illuminize/shared";
import { isApiClientError } from "@illuminize/shared/client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { splitCommaList } from "@/components/common/CommaListInput";
import { Button, ErrorBox, FormField, Input, Select, Textarea } from "@/components/ui";

/**
 * Amounts are edited in major units (rupees, dollars) and sectors as comma-separated text; both are
 * converted to the API shape (minor units, string array) only when the form is validated.
 */
interface FundingFormValues {
  kind: FundingKind;
  title: string;
  stage: FundingStage | null;
  pitch: string;
  amountMin: string;
  amountMax: string;
  currency: string;
  sectorsText: string;
  websiteUrl: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
}

const FORM_FIELD_FOR: Record<string, keyof FundingFormValues> = { amountMinMinor: "amountMin", amountMaxMinor: "amountMax", sectors: "sectorsText" };

function toMinor(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) : Number.NaN;
}

function toMajor(minor: number | null | undefined): string {
  return minor == null ? "" : String(minor / 100);
}

export function FundingForm({ initial, kind, onSubmit, submitLabel }: { initial?: FundingDto; kind: FundingKind; onSubmit: (v: FundingCreateInput) => Promise<void>; submitLabel: string }) {
  const [serverError, setServerError] = useState<unknown>(null);

  const resolver = useMemo<Resolver<FundingFormValues, unknown, FundingCreateInput>>(() => {
    const zod = zodResolver(fundingCreateSchema) as unknown as Resolver<Record<string, unknown>, unknown, FundingCreateInput>;
    return async (values, context, options) => {
      const { amountMin, amountMax, sectorsText, ...rest } = values;
      const result = await zod({ ...rest, amountMinMinor: toMinor(amountMin), amountMaxMinor: toMinor(amountMax), sectors: splitCommaList(sectorsText, 100) }, context, options as never);
      const errors: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(result.errors)) errors[FORM_FIELD_FOR[k] ?? k] = v;
      return { values: result.values, errors } as never;
    };
  }, []);

  const { register, handleSubmit, formState, setError } = useForm<FundingFormValues, unknown, FundingCreateInput>({
    resolver,
    defaultValues: {
      kind,
      title: initial?.title ?? "",
      stage: initial?.stage ?? (kind === "SEEKING" ? "SEED" : null),
      pitch: initial?.pitch ?? "",
      amountMin: toMajor(initial?.amountMinMinor),
      amountMax: toMajor(initial?.amountMaxMinor),
      currency: initial?.currency ?? "INR",
      sectorsText: (initial?.sectors ?? []).join(", "),
      websiteUrl: initial?.websiteUrl ?? null,
      contactEmail: initial?.contactEmail ?? null,
      contactPhone: initial?.contactPhone ?? null,
    },
  });
  const e = formState.errors as Record<string, { message?: string } | undefined>;
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
            for (const [p, m] of Object.entries(err.fieldErrors)) setError((FORM_FIELD_FOR[p] ?? p) as "title", { message: m });
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
        <FormField label={kind === "SEEKING" ? "Minimum raise" : "Minimum cheque"} hint="Whole amount, e.g. 2500000" error={e.amountMin?.message}>
          <Input type="number" min={0} step="any" inputMode="decimal" {...register("amountMin")} />
        </FormField>
        <FormField label={kind === "SEEKING" ? "Maximum raise" : "Maximum cheque"} error={e.amountMax?.message}>
          <Input type="number" min={0} step="any" inputMode="decimal" {...register("amountMax")} />
        </FormField>
        <div className="sm:col-span-2">
          <FormField label={kind === "SEEKING" ? "Pitch" : "Investment thesis"} required error={e.pitch?.message}>
            <Textarea {...register("pitch")} rows={6} />
          </FormField>
        </div>
        <FormField label="Sectors" hint="Comma separated, up to 10" error={e.sectorsText?.message}>
          <Input {...register("sectorsText")} placeholder="Fintech, Climate" />
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
