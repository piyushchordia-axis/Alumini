import {
  BRANDING_FIELD_LABELS,
  blankToNull,
  brandContrastWarnings,
  brandingDraft,
  brandingSave,
  brandPreviewColours,
  brandPreviewText,
  fieldErrorsFrom,
  type BrandingDraft,
  type TenantBrandingUpdate,
  type TenantPublicDto,
} from "@illuminize/shared";
import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { BrandPreview } from "@/components/admin/BrandPreview";
import { ColorField } from "@/components/admin/ColorField";
import { ImageField } from "@/components/admin/ImageField";
import { CountryPicker } from "@/components/CountryPicker";
import { TimeZonePicker } from "@/components/TimeZonePicker";
import { Button, Card, Input, Muted, headingRole } from "@/components/ui";
import { colors, spacing } from "@/theme";

type OptionalText = "shortName" | "tagline" | "welcomeMessage" | "websiteUrl" | "city";

function Heading({ children }: { children: string }) {
  return (
    <Text {...headingRole(2)} style={{ fontSize: 15, fontWeight: "700", color: colors.text }}>
      {children}
    </Text>
  );
}

/**
 * The console's Branding, as the web's BrandingForm: a preview, then the institution's name and welcome, where it is,
 * its colours (suggested ones, and a warning that never stops a save) and its logo and cover. Keyed by the screen on the
 * saved name and primary colour, as on the web. What became of Save is the screen's to say, under this form, as it
 * outlasts that: `onInvalid` hands it a problem found before sending, and `onSubmit` says how the API answered.
 */
export function BrandingForm({
  slug,
  initial,
  onInvalid,
  onSubmit,
}: {
  slug: string;
  initial: TenantPublicDto;
  onInvalid: (problem: string) => void;
  onSubmit: (input: TenantBrandingUpdate) => Promise<void>;
}) {
  const [draft, setDraft] = useState<BrandingDraft>(() => brandingDraft(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState({ logo: false, cover: false });
  const logoBusy = useCallback((on: boolean) => setUploading((u) => ({ ...u, logo: on })), []);
  const coverBusy = useCallback((on: boolean) => setUploading((u) => ({ ...u, cover: on })), []);
  const waiting = uploading.logo || uploading.cover;

  // An edited field's error goes with the edit, so it never sits under a value that's fine now.
  const set = <K extends keyof BrandingDraft>(key: K, value: BrandingDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((e) => {
      if (!(key in e)) return e;
      const next = { ...e };
      delete next[key];
      return next;
    });
  };
  const optional = (key: OptionalText) => (text: string) => set(key, blankToNull(text));

  const save = async () => {
    if (waiting) return;
    const result = brandingSave(draft, initial);
    if (result.errors) {
      setErrors(result.errors);
      // Said by Save too, where the admin is looking: the field it's about may be far above.
      const [key, problem] = Object.entries(result.errors)[0] ?? ["", "Check the branding above"];
      const field = BRANDING_FIELD_LABELS[key as keyof BrandingDraft];
      onInvalid(field ? `${field}: ${problem}` : problem);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await onSubmit(result.input);
    } catch (err) {
      setErrors(fieldErrorsFrom(err));
    } finally {
      setBusy(false);
    }
  };

  const warnings = brandContrastWarnings(draft);
  return (
    <View style={{ gap: spacing.lg }}>
      <BrandPreview name={draft.name} shortName={draft.shortName} tagline={draft.tagline} logoUrl={draft.logoUrl} colours={brandPreviewColours(draft, initial)} />
      <Card>
        <Heading>About</Heading>
        <Input label="Name *" value={draft.name} onChangeText={(text) => set("name", text)} maxLength={120} error={errors.name} />
        <Input label="Short name" value={draft.shortName ?? ""} onChangeText={optional("shortName")} maxLength={40} error={errors.shortName} />
        <Input label="Tagline" value={draft.tagline ?? ""} onChangeText={optional("tagline")} maxLength={160} error={errors.tagline} />
        <Input
          label="Welcome message"
          value={draft.welcomeMessage ?? ""}
          onChangeText={optional("welcomeMessage")}
          multiline
          maxLength={2000}
          hint="Shown on the institution's landing page."
          error={errors.welcomeMessage}
        />
      </Card>
      <Card>
        <Heading>Place</Heading>
        <Input
          label="Website"
          value={draft.websiteUrl ?? ""}
          onChangeText={optional("websiteUrl")}
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="https://"
          error={errors.websiteUrl}
        />
        <Input label="City" value={draft.city ?? ""} onChangeText={optional("city")} maxLength={80} error={errors.city} />
        <CountryPicker label="Country" value={draft.country} onChange={(code) => set("country", code)} clearable error={errors.country} />
        <TimeZonePicker
          value={draft.timezone}
          extra={[initial.timezone]}
          onChange={(zone) => set("timezone", zone)}
          hint="Birthday greetings go out at 9:00 and the weekly digest on Monday morning in this time zone."
          error={errors.timezone}
        />
      </Card>
      <Card>
        <Heading>Colours</Heading>
        <ColorField label="Primary colour" value={draft.primaryColor} onChange={(hex) => set("primaryColor", hex)} placeholder="#1d4ed8" error={errors.primaryColor} warning={warnings.primaryColor} />
        <ColorField label="Secondary colour" value={draft.secondaryColor} onChange={(hex) => set("secondaryColor", hex)} placeholder="#0f172a" error={errors.secondaryColor} warning={warnings.secondaryColor} />
      </Card>
      <Card>
        <Heading>Logo and cover</Heading>
        <ImageField slug={slug} label="Logo" noun="logo" shape="round" name={brandPreviewText(draft).initialsOf} value={draft.logoUrl} onChange={(url) => set("logoUrl", url)} error={errors.logoUrl} onBusyChange={logoBusy} />
        <ImageField slug={slug} label="Cover image" noun="cover" shape="wide" name={draft.name} value={draft.coverImageUrl} onChange={(url) => set("coverImageUrl", url)} error={errors.coverImageUrl} onBusyChange={coverBusy} />
      </Card>
      {waiting && <Muted size={13}>Save waits for the upload to finish.</Muted>}
      <Button title="Save branding" loading={busy} disabled={waiting} onPress={() => void save()} />
    </View>
  );
}
