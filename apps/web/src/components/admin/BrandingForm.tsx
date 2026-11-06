import {
  BRAND_SWATCHES,
  BRANDING_FIELD_LABELS,
  blankToNull,
  brandContrastWarnings,
  brandingDraft,
  brandingSave,
  brandPreviewColours,
  brandPreviewText,
  fieldErrorsFrom,
  isSwatchChosen,
  normalizeHexInput,
  parseHex,
  swatchLabel,
  type BrandingDraft,
  type TenantBrandingUpdate,
  type TenantPublicDto,
} from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import clsx from "clsx";
import { useCallback, useId, useState, type CSSProperties } from "react";
import { CountrySelect } from "@/components/common/CountrySelect";
import { ImageUploader } from "@/components/common/ImageUploader";
import { TimeZoneSelect } from "@/components/common/TimeZoneSelect";
import { IconAlert, IconCheck } from "@/components/icons";
import { Avatar, Button, FormField, Input, Textarea } from "@/components/ui";
import { toast } from "@/stores/uiStore";

/**
 * One of the institution's colours: the browser's colour picker and the hex code, then the suggested colours as radios,
 * as on the phone app's ColorField. `shown` is the colour the picker holds while the code is still being typed.
 * `warning` is what the colour will do to the apps (brandContrastWarnings): it never stops a save.
 */
function ColourField({ label, value, shown, placeholder, error, warning, onChange }: { label: string; value: string; shown: string; placeholder: string; error?: string; warning?: string; onChange: (hex: string) => void }) {
  const errorId = useId();
  return (
    <FormField label={label} group>
      <div className="flex gap-2">
        <input type="color" aria-label={`${label} picker`} value={shown} onChange={(e) => onChange(normalizeHexInput(e.target.value))} className="h-10 w-14 shrink-0 rounded border border-slate-300" />
        <Input
          aria-label={`${label} hex code`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          value={value}
          invalid={!!error}
          maxLength={7}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => onChange(normalizeHexInput(e.target.value))}
          placeholder={placeholder}
        />
      </div>
      {/* Under the box it's about, as on the phone, not under the suggested colours. */}
      {error && (
        <span id={errorId} role="alert" className="mt-1 block text-xs text-red-600">
          {error}
        </span>
      )}
      <div role="radiogroup" aria-label={`Suggested ${label.toLowerCase()}s`} className="mt-2 flex flex-wrap gap-1.5">
        {BRAND_SWATCHES.map((swatch) => {
          const chosen = isSwatchChosen(swatch, value);
          return (
            <button
              key={swatch.hex}
              type="button"
              role="radio"
              aria-checked={chosen}
              aria-label={swatchLabel(swatch)}
              title={swatchLabel(swatch)}
              onClick={() => onChange(swatch.hex)}
              className={clsx(
                "flex h-9 w-9 items-center justify-center rounded-full border-2 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary pointer-coarse:h-11 pointer-coarse:w-11",
                chosen ? "border-slate-900" : "border-transparent hover:border-slate-300",
              )}
            >
              {/* Every suggested colour takes white at 4.5:1 or better. */}
              <span className="flex h-7 w-7 items-center justify-center rounded-full text-white pointer-coarse:h-9 pointer-coarse:w-9" style={{ backgroundColor: swatch.hex }}>
                {chosen && <IconCheck size={16} strokeWidth={2.75} />}
              </span>
            </button>
          );
        })}
      </div>
      {warning && (
        <p className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
          <IconAlert size={14} className="mt-px" />
          <span>{warning}</span>
        </p>
      )}
    </FormField>
  );
}

export function BrandingForm({ initial, onSubmit }: { initial: TenantPublicDto; onSubmit: (input: TenantBrandingUpdate) => Promise<unknown> }) {
  const [v, setV] = useState<BrandingDraft>(() => brandingDraft(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState({ logo: false, cover: false });
  const logoBusy = useCallback((on: boolean) => setUploading((u) => ({ ...u, logo: on })), []);
  const coverBusy = useCallback((on: boolean) => setUploading((u) => ({ ...u, cover: on })), []);
  const waiting = uploading.logo || uploading.cover;
  // An edited field's error goes with the edit, so it never sits under a value that's fine now.
  const set = <K extends keyof BrandingDraft>(k: K, value: BrandingDraft[K]) => {
    setV((s) => ({ ...s, [k]: value }));
    setErrors((e) => {
      if (!(k in e)) return e;
      const next = { ...e };
      delete next[k];
      return next;
    });
  };
  const preview = brandPreviewColours(v, initial);
  // The preview's initials in the colour being chosen (Tailwind's primary reads this variable), not the saved one.
  const draftPrimary = parseHex(preview.from);
  const initialsColour = draftPrimary ? ({ "--c-primary": `${draftPrimary.r} ${draftPrimary.g} ${draftPrimary.b}` } as CSSProperties) : undefined;
  const warnings = brandContrastWarnings(v);
  // The same words as the phone app's preview.
  const shownText = brandPreviewText(v);
  return (
    <form
      className="space-y-5"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        if (waiting) return;
        const result = brandingSave(v, initial);
        if (result.errors) {
          setErrors(result.errors);
          // Said where the admin is looking too: the field it's about may be far above Save.
          const [key, problem] = Object.entries(result.errors)[0] ?? ["", "Check the branding above"];
          const field = BRANDING_FIELD_LABELS[key as keyof BrandingDraft];
          toast.error(field ? `${field}: ${problem}` : problem);
          return;
        }
        setErrors({});
        setBusy(true);
        try {
          await onSubmit(result.input);
          toast.success("Branding saved");
        } catch (err) {
          setErrors(fieldErrorsFrom(err));
          toast.error(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="flex items-center gap-4 rounded-lg border border-slate-200 p-4" style={{ background: `linear-gradient(135deg, ${preview.from}, ${preview.to})`, color: preview.text }}>
        {/* On white, so the initials' brand tint doesn't vanish into the brand gradient. */}
        <span className="shrink-0 rounded-full bg-white p-0.5 shadow-sm" style={initialsColour}>
          <Avatar name={shownText.initialsOf} src={v.logoUrl} size="lg" />
        </span>
        <div>
          <div className="text-xs uppercase tracking-wide opacity-80">Preview</div>
          <div className="text-lg font-semibold">{shownText.title}</div>
          {shownText.tagline && <div className="text-sm opacity-90">{shownText.tagline}</div>}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Name" required error={errors.name}>
          <Input value={v.name} invalid={!!errors.name} maxLength={120} onChange={(e) => set("name", e.target.value)} />
        </FormField>
        <FormField label="Short name" error={errors.shortName}>
          <Input value={v.shortName ?? ""} invalid={!!errors.shortName} maxLength={40} onChange={(e) => set("shortName", blankToNull(e.target.value))} />
        </FormField>
        <FormField label="Tagline" error={errors.tagline}>
          <Input value={v.tagline ?? ""} invalid={!!errors.tagline} onChange={(e) => set("tagline", blankToNull(e.target.value))} maxLength={160} />
        </FormField>
        <FormField label="Website" error={errors.websiteUrl}>
          <Input type="url" value={v.websiteUrl ?? ""} invalid={!!errors.websiteUrl} onChange={(e) => set("websiteUrl", blankToNull(e.target.value))} placeholder="https://" />
        </FormField>
        <FormField label="City" error={errors.city}>
          <Input value={v.city ?? ""} invalid={!!errors.city} maxLength={80} onChange={(e) => set("city", blankToNull(e.target.value))} />
        </FormField>
        <FormField label="Country" error={errors.country}>
          <CountrySelect value={v.country ?? ""} invalid={!!errors.country} onChange={(e) => set("country", e.target.value || null)} />
        </FormField>
        <FormField label="Time zone" error={errors.timezone} hint="Birthday greetings go out at 9:00 and the weekly digest on Monday morning in this time zone.">
          <TimeZoneSelect value={v.timezone} extra={[initial.timezone]} onChange={(e) => set("timezone", e.target.value)} />
        </FormField>
        <ColourField
          label="Primary colour"
          value={v.primaryColor}
          shown={preview.from}
          placeholder="#1d4ed8"
          error={errors.primaryColor}
          warning={warnings.primaryColor}
          onChange={(hex) => set("primaryColor", hex)}
        />
        <ColourField
          label="Secondary colour"
          value={v.secondaryColor}
          shown={preview.to}
          placeholder="#0f172a"
          error={errors.secondaryColor}
          warning={warnings.secondaryColor}
          onChange={(hex) => set("secondaryColor", hex)}
        />
        <div className="sm:col-span-2">
          <FormField label="Welcome message" hint="Shown on the institution's landing page." error={errors.welcomeMessage}>
            <Textarea value={v.welcomeMessage ?? ""} invalid={!!errors.welcomeMessage} onChange={(e) => set("welcomeMessage", blankToNull(e.target.value))} rows={4} maxLength={2000} />
          </FormField>
        </div>
        <FormField label="Logo" group error={errors.logoUrl}>
          <ImageUploader slug={initial.slug} urls={v.logoUrl ? [v.logoUrl] : []} onChange={(u) => set("logoUrl", u[0] ?? null)} label="Upload logo" removeLabel="Remove logo" onBusyChange={logoBusy} />
        </FormField>
        <FormField label="Cover image" group error={errors.coverImageUrl}>
          <ImageUploader slug={initial.slug} urls={v.coverImageUrl ? [v.coverImageUrl] : []} onChange={(u) => set("coverImageUrl", u[0] ?? null)} label="Upload cover" removeLabel="Remove cover" onBusyChange={coverBusy} />
        </FormField>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={busy} disabled={waiting}>
          Save branding
        </Button>
        {waiting && <span className="text-sm text-slate-500">Save waits for the upload to finish.</span>}
      </div>
    </form>
  );
}
