import { type TenantBrandingUpdate, type TenantPublicDto } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useState } from "react";
import { CountrySelect } from "@/components/common/CountrySelect";
import { ImageUploader } from "@/components/common/ImageUploader";
import { Avatar, Button, FormField, Input, Textarea } from "@/components/ui";
import { toast } from "@/stores/uiStore";

export function BrandingForm({ initial, onSubmit }: { initial: TenantPublicDto; onSubmit: (input: TenantBrandingUpdate) => Promise<unknown> }) {
  const [v, setV] = useState<TenantBrandingUpdate>({
    name: initial.name,
    shortName: initial.shortName,
    tagline: initial.tagline,
    welcomeMessage: initial.welcomeMessage,
    websiteUrl: initial.websiteUrl,
    city: initial.city,
    country: initial.country,
    primaryColor: initial.primaryColor,
    secondaryColor: initial.secondaryColor,
    logoUrl: initial.logoUrl,
    coverImageUrl: initial.coverImageUrl,
  });
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof TenantBrandingUpdate>(k: K, value: TenantBrandingUpdate[K]) => setV((s) => ({ ...s, [k]: value }));
  const nullable = (s: string) => (s.trim() ? s : null);
  return (
    <form
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await onSubmit(v);
          toast.success("Branding saved");
        } catch (err) {
          toast.error(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="flex items-center gap-4 rounded-lg border border-slate-200 p-4" style={{ background: `linear-gradient(135deg, ${v.primaryColor}, ${v.secondaryColor})` }}>
        <Avatar name={v.shortName ?? v.name ?? "?"} src={v.logoUrl ?? null} size="lg" />
        <div className="text-white">
          <div className="text-xs uppercase tracking-wide opacity-80">Preview</div>
          <div className="text-lg font-semibold">{v.name}</div>
          <div className="text-sm opacity-90">{v.tagline}</div>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Name" required>
          <Input value={v.name ?? ""} onChange={(e) => set("name", e.target.value)} />
        </FormField>
        <FormField label="Short name">
          <Input value={v.shortName ?? ""} onChange={(e) => set("shortName", nullable(e.target.value))} />
        </FormField>
        <FormField label="Tagline">
          <Input value={v.tagline ?? ""} onChange={(e) => set("tagline", nullable(e.target.value))} maxLength={160} />
        </FormField>
        <FormField label="Website">
          <Input value={v.websiteUrl ?? ""} onChange={(e) => set("websiteUrl", nullable(e.target.value))} placeholder="https://" />
        </FormField>
        <FormField label="City">
          <Input value={v.city ?? ""} onChange={(e) => set("city", nullable(e.target.value))} />
        </FormField>
        <FormField label="Country">
          <CountrySelect value={v.country ?? ""} onChange={(e) => set("country", e.target.value || null)} />
        </FormField>
        <FormField label="Primary colour" group>
          <div className="flex gap-2">
            <input type="color" aria-label="Primary colour picker" value={v.primaryColor ?? "#1d4ed8"} onChange={(e) => set("primaryColor", e.target.value)} className="h-10 w-14 rounded border border-slate-300" />
            <Input aria-label="Primary colour hex code" value={v.primaryColor ?? ""} onChange={(e) => set("primaryColor", e.target.value)} placeholder="#1d4ed8" />
          </div>
        </FormField>
        <FormField label="Secondary colour" group>
          <div className="flex gap-2">
            <input type="color" aria-label="Secondary colour picker" value={v.secondaryColor ?? "#0f172a"} onChange={(e) => set("secondaryColor", e.target.value)} className="h-10 w-14 rounded border border-slate-300" />
            <Input aria-label="Secondary colour hex code" value={v.secondaryColor ?? ""} onChange={(e) => set("secondaryColor", e.target.value)} placeholder="#0f172a" />
          </div>
        </FormField>
        <div className="sm:col-span-2">
          <FormField label="Welcome message" hint="Shown on the institution's landing page.">
            <Textarea value={v.welcomeMessage ?? ""} onChange={(e) => set("welcomeMessage", nullable(e.target.value))} rows={4} maxLength={2000} />
          </FormField>
        </div>
        <FormField label="Logo" group>
          <ImageUploader slug={initial.slug} urls={v.logoUrl ? [v.logoUrl] : []} onChange={(u) => set("logoUrl", u[0] ?? null)} label="Upload logo" />
        </FormField>
        <FormField label="Cover image" group>
          <ImageUploader slug={initial.slug} urls={v.coverImageUrl ? [v.coverImageUrl] : []} onChange={(u) => set("coverImageUrl", u[0] ?? null)} label="Upload cover" />
        </FormField>
      </div>
      <Button type="submit" loading={busy}>
        Save branding
      </Button>
    </form>
  );
}
