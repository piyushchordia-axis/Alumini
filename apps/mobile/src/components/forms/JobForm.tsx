import {
  CAN_REFER_HELP,
  CAN_REFER_LABEL,
  JOB_TYPES,
  JOB_TYPE_LABELS,
  RICH_TEXT_HINT,
  WORK_MODES,
  WORK_MODE_LABELS,
  jobCreateSchema,
  waitingReferralsCloseText,
  type JobCreateInput,
  type JobDto,
  type JobType,
  type WorkMode,
} from "@illuminize/shared";
import { useState } from "react";
import { Text, View } from "react-native";
import { DateTimeField } from "@/components/DateTimeField";
import { Button, ChipSelect, Choice, ErrorText, Input } from "@/components/ui";
import { colors } from "@/theme";
import { useFormErrors } from "./useFormErrors";

const pad = (n: number) => String(n).padStart(2, "0");
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * Create / edit a job. The closing date means "open until the end of that day" on this phone. `offerReferrals` shows "I can
 * refer people for this job", for a member who can use referrals now; otherwise the job keeps whatever it had, as the API
 * ignores the field then. `waitingReferrals` are the requests waiting for the poster's answer, which unticking it would close.
 */
export function JobForm({
  initial,
  submitLabel,
  onSubmit,
  offerReferrals = false,
  waitingReferrals = 0,
}: {
  initial?: JobDto;
  submitLabel: string;
  onSubmit: (v: JobCreateInput) => Promise<void>;
  offerReferrals?: boolean;
  waitingReferrals?: number;
}) {
  const [canRefer, setCanRefer] = useState(initial?.canRefer ?? false);
  const closesWaiting = offerReferrals && !!initial?.canRefer && waitingReferrals > 0 && !canRefer;
  const [title, setTitle] = useState(initial?.title ?? "");
  const [companyName, setCompanyName] = useState(initial?.companyName ?? "");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [workMode, setWorkMode] = useState<WorkMode | "">(initial?.workMode ?? "ON_SITE");
  const [jobType, setJobType] = useState<JobType | "">(initial?.jobType ?? "FULL_TIME");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [applyUrl, setApplyUrl] = useState(initial?.applyUrl ?? "");
  const [contactEmail, setContactEmail] = useState(initial?.contactEmail ?? "");
  const [contactPhone, setContactPhone] = useState(initial?.contactPhone ?? "");
  const [salaryNote, setSalaryNote] = useState(initial?.salaryNote ?? "");
  const [closes, setCloses] = useState<string | null>(initial?.expiresAt ? localDate(new Date(initial.expiresAt)) : null);
  const { errors, serverError, busy, fromZod, run } = useFormErrors();
  const nul = (s: string) => (s.trim() ? s.trim() : null);

  const submit = () =>
    run(async () => {
      const parsed = jobCreateSchema.safeParse({
        title,
        companyName,
        location: nul(location),
        workMode,
        jobType,
        description,
        applyUrl: nul(applyUrl),
        contactEmail: nul(contactEmail),
        contactPhone: nul(contactPhone),
        salaryNote: nul(salaryNote),
        expiresAt: closes ? new Date(`${closes}T23:59:59`).toISOString() : null,
        // Left out unless it was offered, so an edit never changes what the poster couldn't see, and on an edit unless they
        // changed it: a copy of the job read while referrals were off says false, which saving mustn't store.
        canRefer: offerReferrals && (!initial || canRefer !== initial.canRefer) ? canRefer : undefined,
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
      <View role="group" aria-label="Work mode">
        <ChipSelect tall label="Work mode" options={WORK_MODES.map((m) => ({ value: m, label: WORK_MODE_LABELS[m] }))} value={workMode} onChange={setWorkMode} />
      </View>
      <Input label="Description *" value={description} onChangeText={setDescription} multiline placeholder="Role, requirements, how to apply" error={errors.description} hint={RICH_TEXT_HINT} />
      <Input label="Apply link" value={applyUrl} onChangeText={setApplyUrl} autoCapitalize="none" keyboardType="url" placeholder="https://" error={errors.applyUrl} />
      <Input label="Contact email" value={contactEmail} onChangeText={setContactEmail} autoCapitalize="none" keyboardType="email-address" error={errors.contactEmail} />
      <Input label="Contact phone" value={contactPhone} onChangeText={setContactPhone} keyboardType="phone-pad" error={errors.contactPhone} />
      <Input label="Pay note" value={salaryNote} onChangeText={setSalaryNote} placeholder="e.g. ₹18–25 LPA plus ESOPs" error={errors.salaryNote} />
      <DateTimeField label="Applications close" mode="date" value={closes} onChange={setCloses} minimumDate={new Date()} clearable error={errors.expiresAt} hint="Optional. The job leaves the board after this day." />
      {offerReferrals && (
        <View style={{ gap: 6 }}>
          <Choice kind="checkbox" label={CAN_REFER_LABEL} checked={canRefer} hint={CAN_REFER_HELP} onPress={() => setCanRefer((on) => !on)} />
          <Text style={{ fontSize: 12, color: colors.muted }}>{CAN_REFER_HELP}</Text>
          {closesWaiting && (
            <Text role="alert" style={{ fontSize: 12, color: "#92400e" }}>
              {waitingReferralsCloseText(waitingReferrals)}
            </Text>
          )}
        </View>
      )}
      <ErrorText error={serverError} />
      <Button title={submitLabel} onPress={() => void submit()} loading={busy} />
    </>
  );
}
