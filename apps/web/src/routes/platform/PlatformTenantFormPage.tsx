import { TENANT_TYPES, TENANT_TYPE_LABELS, memberYearFields, type PlatformTenantCreateInput, type TenantType } from "@illuminize/shared";
import { errorMessage, isApiClientError } from "@illuminize/shared/client";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CountrySelect } from "@/components/common/CountrySelect";
import { TimeZoneSelect } from "@/components/common/TimeZoneSelect";
import { Button, Card, Checkbox, ErrorBox, FormField, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { toast } from "@/stores/uiStore";

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);

export function PlatformTenantFormPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [shortName, setShortName] = useState("");
  const [type, setType] = useState<TenantType>("COLLEGE");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("IN");
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [tagline, setTagline] = useState("");
  const [welcome, setWelcome] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#1d4ed8");
  const [memberApprovalMode, setMemberApprovalMode] = useState<"AUTO_APPROVE" | "ADMIN_APPROVAL">("ADMIN_APPROVAL");
  const [contentModerationMode, setContentModerationMode] = useState<"AUTO_APPROVE" | "ADMIN_APPROVAL">("AUTO_APPROVE");
  const [withAdmin, setWithAdmin] = useState(true);
  const [adminPhone, setAdminPhone] = useState("+91");
  const [adminName, setAdminName] = useState("");
  const [adminStart, setAdminStart] = useState("");
  const [adminEnd, setAdminEnd] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setErrors({});
    setServerError(null);
    const input: PlatformTenantCreateInput = {
      name,
      slug,
      shortName: shortName || null,
      type,
      city: city || null,
      country: country || null,
      timezone,
      tagline: tagline || null,
      welcomeMessage: welcome || null,
      primaryColor,
      settings: { memberApprovalMode, contentModerationMode },
      ...(withAdmin
        ? { initialAdmin: { phone: adminPhone, fullName: adminName, startYear: adminStart ? Number(adminStart) : undefined, batchYear: adminEnd ? Number(adminEnd) : undefined } }
        : {}),
    };
    try {
      const created = await api.platform.tenants.create(input);
      void qc.invalidateQueries({ queryKey: ["platform"] });
      void qc.invalidateQueries({ queryKey: ["tenants"] });
      void qc.invalidateQueries({ queryKey: ["tenant"] });
    void qc.invalidateQueries({ queryKey: ["tenant"] });
      toast.success(`${created.tenant.name} onboarded`);
      navigate(`/platform/tenants/${created.tenant.id}`);
    } catch (err) {
      if (isApiClientError(err) && Object.keys(err.fieldErrors).length) setErrors(err.fieldErrors);
      else setServerError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const years = memberYearFields(type);
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="Onboard an institution" subtitle="Creates the tenant, its settings and (optionally) its first admin" />
      <Card className="p-5">
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Name" required error={errors.name}>
              <Input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!slugTouched) setSlug(slugify(e.target.value));
                }}
              />
            </FormField>
            <FormField label="URL slug" required error={errors.slug} hint={`illuminize.app/t/${slug || "…"}`}>
              <Input
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(slugify(e.target.value));
                }}
              />
            </FormField>
            <FormField label="Short name" error={errors.shortName}>
              <Input value={shortName} onChange={(e) => setShortName(e.target.value)} />
            </FormField>
            <FormField label="Type" error={errors.type}>
              <Select value={type} onChange={(e) => setType(e.target.value as TenantType)}>
                {TENANT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TENANT_TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="City" error={errors.city}>
              <Input value={city} onChange={(e) => setCity(e.target.value)} />
            </FormField>
            <FormField label="Country" error={errors.country}>
              <CountrySelect value={country} onChange={(e) => setCountry(e.target.value)} />
            </FormField>
            <FormField label="Time zone" error={errors.timezone} hint="For birthday greetings, the weekly digest and new events.">
              <TimeZoneSelect value={timezone} onChange={(e) => setTimezone(e.target.value)} />
            </FormField>
            <FormField label="Tagline" error={errors.tagline}>
              <Input value={tagline} onChange={(e) => setTagline(e.target.value)} />
            </FormField>
            <FormField label="Primary colour" error={errors.primaryColor}>
              <div className="flex gap-2">
                <input type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="h-10 w-14 rounded border border-slate-300" />
                <Input value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} />
              </div>
            </FormField>
            <div className="sm:col-span-2">
              <FormField label="Welcome message" error={errors.welcomeMessage}>
                <Textarea value={welcome} onChange={(e) => setWelcome(e.target.value)} rows={3} />
              </FormField>
            </div>
            <FormField label="Member approval">
              <Select value={memberApprovalMode} onChange={(e) => setMemberApprovalMode(e.target.value as "AUTO_APPROVE" | "ADMIN_APPROVAL")}>
                <option value="ADMIN_APPROVAL">Admin must approve members</option>
                <option value="AUTO_APPROVE">Auto-approve members</option>
              </Select>
            </FormField>
            <FormField label="Content moderation">
              <Select value={contentModerationMode} onChange={(e) => setContentModerationMode(e.target.value as "AUTO_APPROVE" | "ADMIN_APPROVAL")}>
                <option value="AUTO_APPROVE">Publish immediately</option>
                <option value="ADMIN_APPROVAL">Admin must approve content</option>
              </Select>
            </FormField>
          </div>
          <fieldset className="rounded-lg border border-slate-200 p-4">
            <Checkbox checked={withAdmin} onChange={(e) => setWithAdmin(e.target.checked)} label="Create the first institution admin now" className="font-medium" />
            {withAdmin && (
              <>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <FormField label="Admin mobile" required error={errors["initialAdmin.phone"]}>
                    <Input value={adminPhone} onChange={(e) => setAdminPhone(e.target.value)} placeholder="+91…" />
                  </FormField>
                  <FormField label="Admin name" required error={errors["initialAdmin.fullName"]}>
                    <Input value={adminName} onChange={(e) => setAdminName(e.target.value)} />
                  </FormField>
                  <FormField label={years.start.label} error={errors["initialAdmin.startYear"]}>
                    <Input type="number" inputMode="numeric" value={adminStart} onChange={(e) => setAdminStart(e.target.value)} />
                  </FormField>
                  <FormField label={years.end.label} error={errors["initialAdmin.batchYear"]}>
                    <Input type="number" inputMode="numeric" value={adminEnd} onChange={(e) => setAdminEnd(e.target.value)} />
                  </FormField>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  {type === "OTHER"
                    ? "Optional. Left blank, the admin is a member since this year. Fill in “Until” only if they have left."
                    : "Give both years or neither. Left blank, the admin is given last year for both."}
                </p>
              </>
            )}
          </fieldset>
          {serverError ? <ErrorBox error={serverError} /> : null}
          <Button type="submit" loading={busy} disabled={!name || !slug}>
            Onboard institution
          </Button>
        </form>
      </Card>
    </div>
  );
}
