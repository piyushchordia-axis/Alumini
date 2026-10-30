import { JOB_TYPES, JOB_TYPE_LABELS, jobCreateSchema, type JobType } from "@illuminize/shared";
import { errorMessage, isApiClientError } from "@illuminize/shared/client";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Switch, Text } from "react-native";
import { Button, ChipSelect, ErrorText, Input, Row, Screen } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { colors, useTheme } from "@/theme";

export default function NewJobScreen() {
  const { tenant } = useMembership();
  const router = useRouter();
  const qc = useQueryClient();
  const theme = useTheme();
  const [title, setTitle] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [location, setLocation] = useState("");
  const [isRemote, setIsRemote] = useState(false);
  const [jobType, setJobType] = useState<JobType | "">("FULL_TIME");
  const [description, setDescription] = useState("");
  const [applyUrl, setApplyUrl] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [salaryRange, setSalaryRange] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nul = (s: string) => (s.trim() ? s.trim() : null);
  const submit = async () => {
    setErrors({});
    setServerError(null);
    const parsed = jobCreateSchema.safeParse({ title, companyName, location: nul(location), isRemote, jobType, description, applyUrl: nul(applyUrl), contactEmail: nul(contactEmail), salaryRange: nul(salaryRange) });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const i of parsed.error.issues) next[String(i.path[0])] ??= i.message;
      setErrors(next);
      return;
    }
    setBusy(true);
    try {
      const job = await api.jobs.create(tenant.slug, parsed.data);
      void qc.invalidateQueries({ queryKey: ["jobs", tenant.slug] });
      Alert.alert(job.moderationStatus === "PENDING" ? "Submitted — awaiting admin approval" : "Job published");
      router.replace(`/t/${tenant.slug}/jobs/${job.id}`);
    } catch (err) {
      if (isApiClientError(err) && Object.keys(err.fieldErrors).length) setErrors(err.fieldErrors);
      else setServerError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen>
      <Input label="Job title *" value={title} onChangeText={setTitle} error={errors.title} />
      <Input label="Company *" value={companyName} onChangeText={setCompanyName} error={errors.companyName} />
      <ChipSelect label="Type *" options={JOB_TYPES.map((t) => ({ value: t, label: JOB_TYPE_LABELS[t] }))} value={jobType} onChange={setJobType} />
      <Input label="Location" value={location} onChangeText={setLocation} placeholder="City, country" error={errors.location} />
      <Row style={{ justifyContent: "space-between" }}>
        <Text style={{ color: colors.text }}>Remote friendly</Text>
        <Switch value={isRemote} onValueChange={setIsRemote} trackColor={{ true: theme.primary }} />
      </Row>
      <Input label="Description *" value={description} onChangeText={setDescription} multiline error={errors.description} hint="Role, requirements, how to apply." />
      <Input label="Apply link" value={applyUrl} onChangeText={setApplyUrl} autoCapitalize="none" keyboardType="url" placeholder="https://" error={errors.applyUrl} />
      <Input label="Contact email" value={contactEmail} onChangeText={setContactEmail} autoCapitalize="none" keyboardType="email-address" error={errors.contactEmail} />
      <Input label="Salary range" value={salaryRange} onChangeText={setSalaryRange} placeholder="e.g. ₹18–25 LPA" error={errors.salaryRange} />
      <ErrorText error={serverError} />
      <Button title="Post job" onPress={() => void submit()} loading={busy} />
    </Screen>
  );
}
