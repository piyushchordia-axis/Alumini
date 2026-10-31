import { MARITAL_STATUSES, MARITAL_STATUS_LABELS, PROFESSION_TYPES, PROFESSION_TYPE_LABELS, membershipProfileSchema, type MembershipDto, type MembershipProfileInput, type TenantPublicDto } from "@illuminize/shared";
import { errorMessage, isApiClientError } from "@illuminize/shared/client";
import { useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import { CountryPicker } from "@/components/CountryPicker";
import { DateTimeField } from "@/components/DateTimeField";
import { Avatar, Button, ChipSelect, ErrorText, Input, Muted, Row } from "@/components/ui";
import { useImageUpload } from "@/hooks/useImagePicker";
import { colors, useTheme } from "@/theme";

type Form = {
  fullName: string;
  batchYear: string;
  dateOfBirth: string;
  professionType: MembershipProfileInput["professionType"];
  companyName: string;
  designation: string;
  city: string;
  country: string;
  maritalStatus: string;
  kidsCount: string;
  bio: string;
  linkedinUrl: string;
  interests: string;
  avatarUrl: string | null;
  isPhoneVisible: boolean;
};

const fromMembership = (m?: Partial<MembershipDto>): Form => ({
  fullName: m?.fullName ?? "",
  batchYear: m?.batchYear ? String(m.batchYear) : "",
  dateOfBirth: m?.dateOfBirth ?? "",
  professionType: m?.professionType ?? "EMPLOYED",
  companyName: m?.companyName ?? "",
  designation: m?.designation ?? "",
  city: m?.city ?? "",
  country: m?.country ?? "IN",
  maritalStatus: m?.maritalStatus ?? "",
  kidsCount: m?.kidsCount != null ? String(m.kidsCount) : "",
  bio: m?.bio ?? "",
  linkedinUrl: m?.linkedinUrl ?? "",
  interests: (m?.interests ?? []).join(", "),
  avatarUrl: m?.avatarUrl ?? null,
  isPhoneVisible: m?.isPhoneVisible ?? false,
});

export function ProfileForm({ tenant, initial, submitLabel, onSubmit }: { tenant: TenantPublicDto; initial?: Partial<MembershipDto>; submitLabel: string; onSubmit: (v: MembershipProfileInput) => Promise<void> }) {
  const theme = useTheme();
  const [f, setF] = useState<Form>(fromMembership(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(!!initial?.bio);
  const upload = useImageUpload(tenant.slug);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((s) => ({ ...s, [k]: v }));
  const nul = (s: string) => (s.trim() ? s.trim() : null);

  const submit = async () => {
    setErrors({});
    setServerError(null);
    const raw = {
      fullName: f.fullName,
      batchYear: f.batchYear,
      dateOfBirth: nul(f.dateOfBirth),
      professionType: f.professionType,
      companyName: nul(f.companyName),
      designation: nul(f.designation),
      city: nul(f.city),
      country: nul(f.country),
      maritalStatus: nul(f.maritalStatus),
      kidsCount: f.kidsCount.trim() ? Number(f.kidsCount) : null,
      bio: nul(f.bio),
      linkedinUrl: nul(f.linkedinUrl),
      interests: f.interests
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 20),
      avatarUrl: f.avatarUrl,
      isPhoneVisible: f.isPhoneVisible,
    };
    const parsed = membershipProfileSchema.safeParse(raw);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const i of parsed.error.issues) {
        const k = String(i.path[0] ?? "");
        if (!next[k]) next[k] = i.message;
      }
      setErrors(next);
      return;
    }
    if (parsed.data.batchYear < tenant.settings.minBatchYear || parsed.data.batchYear > tenant.settings.maxBatchYear) {
      setErrors({ batchYear: `Must be between ${tenant.settings.minBatchYear} and ${tenant.settings.maxBatchYear}` });
      return;
    }
    setBusy(true);
    try {
      await onSubmit(parsed.data);
    } catch (err) {
      if (isApiClientError(err) && Object.keys(err.fieldErrors).length) setErrors(err.fieldErrors);
      else setServerError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 14 }}>
      <Row gap={12}>
        <Avatar name={f.fullName || "?"} src={f.avatarUrl} size={64} />
        <Button
          title={upload.busy ? "Uploading…" : f.avatarUrl ? "Change photo" : "Add photo"}
          variant="outline"
          loading={upload.busy}
          onPress={async () => {
            const url = await upload.pickAndUpload();
            if (url) set("avatarUrl", url);
          }}
        />
        {f.avatarUrl && (
          <Pressable onPress={() => set("avatarUrl", null)}>
            <Muted>Remove</Muted>
          </Pressable>
        )}
      </Row>
      <Input label="Full name *" value={f.fullName} onChangeText={(v) => set("fullName", v)} error={errors.fullName} autoComplete="name" />
      <Input label="Batch (year of passing out) *" value={f.batchYear} onChangeText={(v) => set("batchYear", v.replace(/\D/g, "").slice(0, 4))} keyboardType="number-pad" error={errors.batchYear} hint={`${tenant.settings.minBatchYear} – ${tenant.settings.maxBatchYear}`} />
      <ChipSelect label="What do you do? *" options={PROFESSION_TYPES.map((p) => ({ value: p, label: PROFESSION_TYPE_LABELS[p] }))} value={f.professionType} onChange={(v) => v && set("professionType", v)} />
      <Input label={f.professionType === "STUDENT" ? "Institution" : f.professionType === "EMPLOYED" ? "Company" : "Company / business"} value={f.companyName} onChangeText={(v) => set("companyName", v)} error={errors.companyName} />
      <Input label="Designation / role" value={f.designation} onChangeText={(v) => set("designation", v)} error={errors.designation} />
      <Input label="Current city" value={f.city} onChangeText={(v) => set("city", v)} error={errors.city} />
      <CountryPicker label="Country" value={f.country || null} onChange={(v) => set("country", v ?? "")} clearable error={errors.country} />
      <DateTimeField
        label="Date of birth"
        mode="date"
        value={f.dateOfBirth || null}
        onChange={(v) => set("dateOfBirth", v ?? "")}
        maximumDate={new Date(new Date().getFullYear() - 10, 11, 31)}
        minimumDate={new Date(1900, 0, 1)}
        error={errors.dateOfBirth}
        clearable
      />
      <Pressable onPress={() => setMore((m) => !m)}>
        <Text style={{ color: theme.primary, fontWeight: "600" }}>{more ? "Hide optional details" : "More about you (optional)"}</Text>
      </Pressable>
      {more && (
        <View style={{ gap: 14 }}>
          <ChipSelect label="Marital status" options={MARITAL_STATUSES.map((m) => ({ value: m, label: MARITAL_STATUS_LABELS[m] }))} value={f.maritalStatus as (typeof MARITAL_STATUSES)[number] | ""} onChange={(v) => set("maritalStatus", v)} allowEmpty />
          <Input label="Number of kids" value={f.kidsCount} onChangeText={(v) => set("kidsCount", v.replace(/\D/g, ""))} keyboardType="number-pad" error={errors.kidsCount} />
          <Input label="LinkedIn profile" value={f.linkedinUrl} onChangeText={(v) => set("linkedinUrl", v)} placeholder="https://www.linkedin.com/in/…" autoCapitalize="none" error={errors.linkedinUrl} />
          <Input label="Interests" value={f.interests} onChangeText={(v) => set("interests", v)} placeholder="cricket, startups, travel" hint="Comma separated" error={errors.interests} />
          <Input label="Short bio" value={f.bio} onChangeText={(v) => set("bio", v)} multiline maxLength={1000} error={errors.bio} />
          <Row style={{ justifyContent: "space-between" }}>
            <Text style={{ color: colors.text, flex: 1 }}>Show my phone number to other members</Text>
            <Switch value={f.isPhoneVisible} onValueChange={(v) => set("isPhoneVisible", v)} trackColor={{ true: theme.primary }} />
          </Row>
        </View>
      )}
      <ErrorText error={serverError} />
      <Button title={submitLabel} onPress={() => void submit()} loading={busy} />
    </View>
  );
}
