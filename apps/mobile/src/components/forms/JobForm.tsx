import { JOB_TYPES, JOB_TYPE_LABELS, jobCreateSchema, type JobCreateInput, type JobDto, type JobType } from "@illuminize/shared";
import { useState } from "react";
import { Switch, Text } from "react-native";
import { DateTimeField } from "@/components/DateTimeField";
import { Button, ChipSelect, ErrorText, Input, Row } from "@/components/ui";
import { colors, useTheme } from "@/theme";
import { useFormErrors } from "./useFormErrors";

const pad = (n: number) => String(n).padStart(2, "0");
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Create / edit a job. The closing date means "open until the end of that day" on this phone. */
export function JobForm({ initial, submitLabel, onSubmit }: { initial?: JobDto; submitLabel: string; onSubmit: (v: JobCreateInput) => Promise<void> }) {
  const theme = useTheme();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [companyName, setCompanyName] = useState(initial?.companyName ?? "");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [isRemote, setIsRemote] = useState(initial?.isRemote ?? false);
  const [jobType, setJobType] = useState<JobType | "">(initial?.jobType ?? "FULL_TIME");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [applyUrl, setApplyUrl] = useState(initial?.applyUrl ?? "");
  const [contactEmail, setContactEmail] = useState(initial?.contactEmail ?? "");
  const [contactPhone, setContactPhone] = useState(initial?.contactPhone ?? "");
  const [salaryRange, setSalaryRange] = useState(initial?.salaryRange ?? "");
  const [closes, setCloses] = useState<string | null>(initial?.expiresAt ? localDate(new Date(initial.expiresAt)) : null);
  const { errors, serverError, busy, fromZod, run } = useFormErrors();
  const nul = (s: string) => (s.trim() ? s.trim() : null);

  const submit = () =>
    run(async () => {
      const parsed = jobCreateSchema.safeParse({
        title,
        companyName,
        location: nul(location),
        isRemote,
        jobType,
        description,
        applyUrl: nul(applyUrl),
        contactEmail: nul(contactEmail),
        contactPhone: nul(contactPhone),
        salaryRange: nul(salaryRange),
        expiresAt: closes ? new Date(`${closes}T23:59:59`).toISOString() : null,
      });
      if (!parsed.success) return fromZod(parsed.error);
      await onSubmit(parsed.data);
    });

  return (
    <>
      <Input label="Job title *" value={title} onChangeText={setTitle} error={errors.title} />
      <Input label="Company *" value={companyName} onChangeText={setCompanyName} error={errors.companyName} />
      <ChipSelect label="Type *" options={JOB_TYPES.map((t) => ({ value: t, label: JOB_TYPE_LABELS[t] }))} value={jobType} onChange={setJobType} />
      <Input label="Location" value={location} onChangeText={setLocation} placeholder="City, country" error={errors.location} />
      <Row style={{ justifyContent: "space-between" }}>
        <Text style={{ color: colors.text }}>Remote friendly</Text>
        <Switch value={isRemote} onValueChange={setIsRemote} trackColor={{ true: theme.primary }} accessibilityLabel="Remote friendly" />
      </Row>
      <Input label="Description *" value={description} onChangeText={setDescription} multiline error={errors.description} hint="Role, requirements, how to apply." />
      <Input label="Apply link" value={applyUrl} onChangeText={setApplyUrl} autoCapitalize="none" keyboardType="url" placeholder="https://" error={errors.applyUrl} />
      <Input label="Contact email" value={contactEmail} onChangeText={setContactEmail} autoCapitalize="none" keyboardType="email-address" error={errors.contactEmail} />
      <Input label="Contact phone" value={contactPhone} onChangeText={setContactPhone} keyboardType="phone-pad" error={errors.contactPhone} />
      <Input label="Salary range" value={salaryRange} onChangeText={setSalaryRange} placeholder="e.g. ₹18–25 LPA" error={errors.salaryRange} />
      <DateTimeField label="Applications close" mode="date" value={closes} onChange={setCloses} minimumDate={new Date()} clearable error={errors.expiresAt} hint="Optional. The job leaves the board after this day." />
      <ErrorText error={serverError} />
      <Button title={submitLabel} onPress={() => void submit()} loading={busy} />
    </>
  );
}
