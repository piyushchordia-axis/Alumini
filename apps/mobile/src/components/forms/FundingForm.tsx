import { FUNDING_STAGES, FUNDING_STAGE_LABELS, fundingCreateSchema, type FundingCreateInput, type FundingDto, type FundingKind, type FundingStage } from "@illuminize/shared";
import { useState } from "react";
import { Button, ChipSelect, ErrorText, Input, Title } from "@/components/ui";
import { useFormErrors } from "./useFormErrors";

const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD"] as const;
type Currency = (typeof CURRENCIES)[number];

/** Amounts are typed in major units (rupees, dollars) and stored in minor units. */
const toMinor = (s: string) => {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) : Number.NaN;
};
const toMajor = (minor: number | null | undefined) => (minor == null ? "" : String(minor / 100));

export function FundingForm({ kind, initial, submitLabel, onSubmit }: { kind: FundingKind; initial?: FundingDto; submitLabel: string; onSubmit: (v: FundingCreateInput) => Promise<void> }) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [stage, setStage] = useState<FundingStage | "">(initial ? (initial.stage ?? "") : kind === "SEEKING" ? "SEED" : "");
  const [pitch, setPitch] = useState(initial?.pitch ?? "");
  const [min, setMin] = useState(toMajor(initial?.amountMinMinor));
  const [max, setMax] = useState(toMajor(initial?.amountMaxMinor));
  const [currency, setCurrency] = useState<Currency | "">((CURRENCIES as readonly string[]).includes(initial?.currency ?? "") ? (initial!.currency as Currency) : "INR");
  const [sectors, setSectors] = useState((initial?.sectors ?? []).join(", "));
  const [websiteUrl, setWebsiteUrl] = useState(initial?.websiteUrl ?? "");
  const [contactEmail, setContactEmail] = useState(initial?.contactEmail ?? "");
  const [contactPhone, setContactPhone] = useState(initial?.contactPhone ?? "");
  const { errors, serverError, busy, fromZod, run } = useFormErrors();
  const nul = (s: string) => (s.trim() ? s.trim() : null);

  const submit = () =>
    run(async () => {
      const parsed = fundingCreateSchema.safeParse({
        kind,
        title,
        stage: stage || null,
        pitch,
        amountMinMinor: toMinor(min),
        amountMaxMinor: toMinor(max),
        currency: currency || "INR",
        sectors: sectors
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        websiteUrl: nul(websiteUrl),
        contactEmail: nul(contactEmail),
        contactPhone: nul(contactPhone),
      });
      if (!parsed.success) return fromZod(parsed.error);
      await onSubmit(parsed.data);
    });

  return (
    <>
      {!initial && <Title>{kind === "SEEKING" ? "Raise from alumni" : "Offer to invest"}</Title>}
      <Input label={kind === "SEEKING" ? "Startup / company name *" : "Headline *"} value={title} onChangeText={setTitle} error={errors.title} />
      <ChipSelect label={kind === "SEEKING" ? "Stage *" : "Preferred stage"} options={FUNDING_STAGES.map((s) => ({ value: s, label: FUNDING_STAGE_LABELS[s] }))} value={stage} onChange={setStage} allowEmpty={kind === "OFFERING"} />
      <ChipSelect label="Currency" options={CURRENCIES.map((c) => ({ value: c, label: c }))} value={currency} onChange={setCurrency} />
      <Input label={kind === "SEEKING" ? "Minimum raise" : "Minimum cheque"} value={min} onChangeText={setMin} keyboardType="decimal-pad" error={errors.amountMinMinor} hint="Whole amount, e.g. 2500000" />
      <Input label={kind === "SEEKING" ? "Maximum raise" : "Maximum cheque"} value={max} onChangeText={setMax} keyboardType="decimal-pad" error={errors.amountMaxMinor} />
      <Input label={kind === "SEEKING" ? "Pitch *" : "Investment thesis *"} value={pitch} onChangeText={setPitch} multiline error={errors.pitch} />
      <Input label="Sectors" value={sectors} onChangeText={setSectors} placeholder="fintech, SaaS" hint="Comma separated, up to 10" error={errors.sectors} />
      <Input label="Website" value={websiteUrl} onChangeText={setWebsiteUrl} autoCapitalize="none" keyboardType="url" placeholder="https://" error={errors.websiteUrl} />
      <Input label="Contact email" value={contactEmail} onChangeText={setContactEmail} autoCapitalize="none" keyboardType="email-address" error={errors.contactEmail} />
      <Input label="Contact phone" value={contactPhone} onChangeText={setContactPhone} keyboardType="phone-pad" error={errors.contactPhone} />
      <ErrorText error={serverError} />
      <Button title={submitLabel} onPress={() => void submit()} loading={busy} />
    </>
  );
}
