import { FUNDING_STAGES, FUNDING_STAGE_LABELS, fundingCreateSchema, type FundingStage } from "@illuminize/shared";
import { errorMessage, isApiClientError } from "@illuminize/shared/client";
import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert } from "react-native";
import { Button, ChipSelect, ErrorText, Input, Screen, Title } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";

export default function NewFundingScreen() {
  const { tenant } = useMembership();
  const { kind: kindParam } = useLocalSearchParams<{ kind?: string }>();
  const kind = kindParam === "OFFERING" ? "OFFERING" : "SEEKING";
  const router = useRouter();
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [stage, setStage] = useState<FundingStage | "">(kind === "SEEKING" ? "SEED" : "");
  const [pitch, setPitch] = useState("");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [currency, setCurrency] = useState<"INR" | "USD" | "EUR" | "GBP" | "AED" | "SGD" | "">("INR");
  const [sectors, setSectors] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const money = (s: string) => (s.trim() ? Math.round(Number(s) * 100) : null);
  const nul = (s: string) => (s.trim() ? s.trim() : null);
  const submit = async () => {
    setErrors({});
    setServerError(null);
    const parsed = fundingCreateSchema.safeParse({
      kind,
      title,
      stage: stage || null,
      pitch,
      amountMinMinor: money(min),
      amountMaxMinor: money(max),
      currency: currency || "INR",
      sectors: sectors
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 10),
      websiteUrl: nul(websiteUrl),
      contactEmail: nul(contactEmail),
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const i of parsed.error.issues) next[String(i.path[0])] ??= i.message;
      setErrors(next);
      return;
    }
    setBusy(true);
    try {
      const item = await api.funding.create(tenant.slug, parsed.data);
      void qc.invalidateQueries({ queryKey: ["funding", tenant.slug] });
      Alert.alert(item.moderationStatus === "PENDING" ? "Submitted — awaiting admin approval" : "Listing published");
      router.replace(`/t/${tenant.slug}/funding/${item.id}`);
    } catch (err) {
      if (isApiClientError(err) && Object.keys(err.fieldErrors).length) setErrors(err.fieldErrors);
      else setServerError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen>
      <Title>{kind === "SEEKING" ? "Raise from alumni" : "Offer to invest"}</Title>
      <Input label={kind === "SEEKING" ? "Startup / company name *" : "Headline *"} value={title} onChangeText={setTitle} error={errors.title} />
      <ChipSelect label={kind === "SEEKING" ? "Stage *" : "Preferred stage"} options={FUNDING_STAGES.map((s) => ({ value: s, label: FUNDING_STAGE_LABELS[s] }))} value={stage} onChange={setStage} allowEmpty={kind === "OFFERING"} />
      <ChipSelect label="Currency" options={(["INR", "USD", "EUR", "GBP", "AED", "SGD"] as const).map((c) => ({ value: c, label: c }))} value={currency} onChange={setCurrency} />
      <Input label={kind === "SEEKING" ? "Minimum raise" : "Minimum cheque"} value={min} onChangeText={setMin} keyboardType="numeric" error={errors.amountMinMinor} hint="In major units, e.g. 2500000" />
      <Input label={kind === "SEEKING" ? "Maximum raise" : "Maximum cheque"} value={max} onChangeText={setMax} keyboardType="numeric" error={errors.amountMaxMinor} />
      <Input label={kind === "SEEKING" ? "Pitch *" : "Investment thesis *"} value={pitch} onChangeText={setPitch} multiline error={errors.pitch} />
      <Input label="Sectors" value={sectors} onChangeText={setSectors} placeholder="fintech, SaaS" hint="Comma separated" error={errors.sectors} />
      <Input label="Website" value={websiteUrl} onChangeText={setWebsiteUrl} autoCapitalize="none" keyboardType="url" placeholder="https://" error={errors.websiteUrl} />
      <Input label="Contact email" value={contactEmail} onChangeText={setContactEmail} autoCapitalize="none" keyboardType="email-address" error={errors.contactEmail} />
      <ErrorText error={serverError} />
      <Button title="Publish listing" onPress={() => void submit()} loading={busy} />
    </Screen>
  );
}
