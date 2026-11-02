import { BUSINESS_CATEGORIES, BUSINESS_CATEGORY_LABELS, businessCreateSchema, type BusinessCategory, type BusinessCreateInput, type BusinessDto } from "@illuminize/shared";
import { useState } from "react";
import { Avatar, Button, ChipSelect, ErrorText, Input, Row } from "@/components/ui";
import { useImageUpload } from "@/hooks/useImagePicker";
import { useFormErrors } from "./useFormErrors";

const CONTACT_HINT = "Shown on this listing's page, not in the list.";

export function BusinessForm({ slug, initial, submitLabel, onSubmit }: { slug: string; initial?: BusinessDto; submitLabel: string; onSubmit: (v: BusinessCreateInput) => Promise<void> }) {
  const [name, setName] = useState(initial?.name ?? "");
  // Nothing chosen to start with: a preselected "Other" would quietly fill the filter with listings nobody can find.
  const [category, setCategory] = useState<BusinessCategory | "">(initial?.category ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [logoUrl, setLogoUrl] = useState<string | null>(initial?.logoUrl ?? null);
  const [city, setCity] = useState(initial?.city ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(initial?.websiteUrl ?? "");
  const [contactEmail, setContactEmail] = useState(initial?.contactEmail ?? "");
  const [contactPhone, setContactPhone] = useState(initial?.contactPhone ?? "");
  const upload = useImageUpload(slug);
  const { errors, serverError, busy, fromZod, run } = useFormErrors();
  const nul = (s: string) => (s.trim() ? s.trim() : null);

  const submit = () =>
    run(async () => {
      const parsed = businessCreateSchema.safeParse({ name, category, description, logoUrl, city: nul(city), websiteUrl: nul(websiteUrl), contactEmail: nul(contactEmail), contactPhone: nul(contactPhone) });
      if (!parsed.success) return fromZod(parsed.error);
      await onSubmit(parsed.data);
    });

  return (
    <>
      <Input label="Business name *" value={name} onChangeText={setName} error={errors.name} />
      <ChipSelect label="Category *" options={BUSINESS_CATEGORIES.map((c) => ({ value: c, label: BUSINESS_CATEGORY_LABELS[c] }))} value={category} onChange={setCategory} />
      <ErrorText error={errors.category} />
      <Input label="City" value={city} onChangeText={setCity} error={errors.city} />
      <Input label="Description *" value={description} onChangeText={setDescription} multiline hint="What you do, and anything alumni should know." error={errors.description} />
      <Row>
        {logoUrl && <Avatar name={name} src={logoUrl} size={56} />}
        <Button
          title={logoUrl ? "Change logo" : "📷 Add logo"}
          variant="outline"
          loading={upload.busy}
          onPress={async () => {
            const url = await upload.pickAndUpload();
            if (url) setLogoUrl(url);
          }}
        />
        {logoUrl && <Button title="Remove logo" variant="ghost" onPress={() => setLogoUrl(null)} />}
      </Row>
      <ErrorText error={errors.logoUrl} />
      <Input label="Website" value={websiteUrl} onChangeText={setWebsiteUrl} autoCapitalize="none" keyboardType="url" placeholder="https://" error={errors.websiteUrl} />
      <Input label="Contact email" value={contactEmail} onChangeText={setContactEmail} autoCapitalize="none" keyboardType="email-address" hint={CONTACT_HINT} error={errors.contactEmail} />
      <Input label="Contact phone" value={contactPhone} onChangeText={setContactPhone} keyboardType="phone-pad" hint={CONTACT_HINT} error={errors.contactPhone} />
      <ErrorText error={serverError} />
      <Button title={submitLabel} onPress={() => void submit()} loading={busy} />
    </>
  );
}
