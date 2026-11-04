import {
  CAN_REFER_HELP,
  CAN_REFER_LABEL,
  COMPANY_SIZES,
  COMPANY_SIZE_LABELS,
  INDUSTRIES,
  INDUSTRY_LABELS,
  JOB_EXPERIENCE_MAX_YEARS,
  JOB_MAX_SKILLS,
  JOB_SENIORITIES,
  JOB_SENIORITY_LABELS,
  JOB_SKILL_MAX_LENGTH,
  JOB_TYPES,
  JOB_TYPE_LABELS,
  RICH_TEXT_HINT,
  SALARY_CURRENCIES,
  SALARY_CURRENCY_LABELS,
  SALARY_PERIODS,
  SALARY_PERIOD_LABELS,
  WORK_MODES,
  WORK_MODE_LABELS,
  experienceLabel,
  formatSalary,
  jobCreateSchema,
  toMajor,
  toMinor,
  waitingReferralsCloseText,
  type CompanyDetails,
  type CompanySize,
  type Industry,
  type JobCreateInput,
  type JobDto,
  type JobSeniority,
  type JobType,
  type SalaryCurrency,
  type SalaryPeriod,
  type WorkMode,
} from "@illuminize/shared";
import { useRef, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { DateTimeField } from "@/components/DateTimeField";
import { CompanyLogo } from "@/components/jobs/CompanyLogo";
import { CompanyReuseOffer } from "@/components/jobs/CompanyReuse";
import { OptionPicker } from "@/components/OptionPicker";
import { SkillsInput, type SkillsInputHandle } from "@/components/SkillsInput";
import { Button, Card, ChipSelect, Choice, ErrorText, Input, Row } from "@/components/ui";
import { useImageUpload } from "@/hooks/useImagePicker";
import { colors, radius, spacing } from "@/theme";
import { useFormErrors } from "./useFormErrors";

const pad = (n: number) => String(n).padStart(2, "0");
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** A number typed in a box: null when it's empty, NaN when it isn't a number, which validation refuses. */
function typedNumber(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : Number.NaN;
}

/** Pay is typed in major units (rupees, dollars) and stored in minor units, as in the funding form. */
const payMinor = (text: string, currency: string) => {
  const major = typedNumber(text);
  return major == null ? null : toMinor(major, currency);
};
const numberText = (n: number | null | undefined) => (n == null ? "" : String(n));
/** Years as the preview reads them: only a whole number of years in range counts. */
const previewYears = (text: string) => {
  const n = typedNumber(text);
  return n != null && Number.isInteger(n) && n >= 0 && n <= JOB_EXPERIENCE_MAX_YEARS ? n : null;
};
const nul = (s: string) => (s.trim() ? s.trim() : null);
const INDUSTRY_OPTIONS = INDUSTRIES.map((i) => ({ value: i, label: INDUSTRY_LABELS[i] }));
/**
 * What a number box says when what's typed won't do, in place of zod's "expected number, received NaN" or "Too big:
 * expected number to be <=50": a phone's number pad keeps letters out, but a paste or the web export's keyboard doesn't.
 */
const numberMessage = (issue: { code: string; expected?: string; origin?: string; minimum?: unknown; maximum?: unknown }) => {
  if (issue.code === "invalid_type" && issue.expected === "number") return "Enter a number";
  if (issue.code === "invalid_type" && issue.expected === "int") return "Enter a whole number";
  if (issue.code === "too_big" && issue.origin === "number") return `Enter a number no more than ${String(issue.maximum)}`;
  if (issue.code === "too_small" && issue.origin === "number") return `Enter a number no less than ${String(issue.minimum)}`;
  return undefined;
};

/** What the form edits: years, openings and pay as typed, pay in major units. */
interface Values {
  title: string;
  companyName: string;
  jobType: JobType | "";
  workMode: WorkMode | "";
  location: string;
  seniority: JobSeniority | "";
  experienceMin: string;
  experienceMax: string;
  skills: string[];
  educationRequirement: string;
  salaryCurrency: SalaryCurrency | "";
  salaryPeriod: SalaryPeriod | "";
  salaryMin: string;
  salaryMax: string;
  salaryNote: string;
  openings: string;
  description: string;
  responsibilities: string;
  requirements: string;
  benefits: string;
  companyLogoUrl: string | null;
  companyWebsite: string;
  companyIndustry: Industry | "";
  companySize: CompanySize | "";
  aboutCompany: string;
  applyUrl: string;
  contactEmail: string;
  contactPhone: string;
  howToApply: string;
  /** "YYYY-MM-DD": open until the end of that day on this phone. */
  closes: string | null;
}

function defaults(initial: JobDto | undefined): Values {
  const currency = initial?.salaryCurrency ?? "INR";
  const major = (minor: number | null | undefined) => (minor == null ? "" : String(toMajor(minor, currency)));
  return {
    title: initial?.title ?? "",
    companyName: initial?.companyName ?? "",
    jobType: initial?.jobType ?? "FULL_TIME",
    workMode: initial?.workMode ?? "ON_SITE",
    location: initial?.location ?? "",
    seniority: initial?.seniority ?? "",
    experienceMin: numberText(initial?.experienceMin),
    experienceMax: numberText(initial?.experienceMax),
    skills: initial?.skills ?? [],
    educationRequirement: initial?.educationRequirement ?? "",
    salaryCurrency: currency,
    salaryPeriod: initial?.salaryPeriod ?? "YEAR",
    salaryMin: major(initial?.salaryMinMinor),
    salaryMax: major(initial?.salaryMaxMinor),
    salaryNote: initial?.salaryNote ?? "",
    openings: numberText(initial?.openings),
    description: initial?.description ?? "",
    responsibilities: initial?.responsibilities ?? "",
    requirements: initial?.requirements ?? "",
    benefits: initial?.benefits ?? "",
    companyLogoUrl: initial?.companyLogoUrl ?? null,
    companyWebsite: initial?.companyWebsite ?? "",
    companyIndustry: initial?.companyIndustry ?? "",
    companySize: initial?.companySize ?? "",
    aboutCompany: initial?.aboutCompany ?? "",
    applyUrl: initial?.applyUrl ?? "",
    contactEmail: initial?.contactEmail ?? "",
    contactPhone: initial?.contactPhone ?? "",
    howToApply: initial?.howToApply ?? "",
    closes: initial?.expiresAt ? localDate(new Date(initial.expiresAt)) : null,
  };
}

/** What the API takes, from what the form holds: every field, as the form shows them all. */
function toInput(v: Values) {
  const currency = v.salaryCurrency || "INR";
  return {
    title: v.title,
    companyName: v.companyName,
    jobType: v.jobType,
    workMode: v.workMode,
    location: nul(v.location),
    seniority: v.seniority || null,
    experienceMin: typedNumber(v.experienceMin),
    experienceMax: typedNumber(v.experienceMax),
    skills: v.skills,
    educationRequirement: nul(v.educationRequirement),
    salaryCurrency: currency,
    salaryPeriod: v.salaryPeriod || "YEAR",
    salaryMinMinor: payMinor(v.salaryMin, currency),
    salaryMaxMinor: payMinor(v.salaryMax, currency),
    salaryNote: nul(v.salaryNote),
    openings: typedNumber(v.openings),
    description: v.description,
    responsibilities: nul(v.responsibilities),
    requirements: nul(v.requirements),
    benefits: nul(v.benefits),
    companyLogoUrl: v.companyLogoUrl,
    companyWebsite: nul(v.companyWebsite),
    companyIndustry: v.companyIndustry || null,
    companySize: v.companySize || null,
    aboutCompany: nul(v.aboutCompany),
    applyUrl: nul(v.applyUrl),
    contactEmail: nul(v.contactEmail),
    contactPhone: nul(v.contactPhone),
    howToApply: nul(v.howToApply),
    expiresAt: v.closes ? new Date(`${v.closes}T23:59:59`).toISOString() : null,
  };
}

/** Each field's name as the form shows it, for the line by the button that says which ones need fixing. */
const FIELD_LABELS: Partial<Record<keyof JobCreateInput, string>> = {
  title: "Job title",
  companyName: "Company",
  jobType: "Type",
  workMode: "Work mode",
  location: "Location",
  seniority: "Seniority",
  experienceMin: "Minimum experience",
  experienceMax: "Maximum experience",
  skills: "Skills",
  educationRequirement: "Education",
  salaryCurrency: "Currency",
  salaryPeriod: "Pay period",
  salaryMinMinor: "Minimum pay",
  salaryMaxMinor: "Maximum pay",
  salaryNote: "Pay note",
  openings: "Openings",
  description: "About the role",
  responsibilities: "Responsibilities",
  requirements: "Requirements",
  benefits: "Benefits",
  companyLogoUrl: "Logo",
  companyWebsite: "Website",
  companyIndustry: "Industry",
  companySize: "Company size",
  aboutCompany: "About the company",
  applyUrl: "Apply link",
  contactEmail: "Contact email",
  contactPhone: "Contact phone",
  howToApply: "How to apply",
  expiresAt: "Applications close",
};

/** A heading's level, which React Native's types don't know: each part is an h2 on the web export. */
const level2 = { "aria-level": 2 } as object;
const labelStyle = { fontSize: 13, fontWeight: "600", color: "#334155" } as const;
const errorStyle = { color: colors.danger, fontSize: 12 } as const;
const hintStyle = { color: colors.muted, fontSize: 12 } as const;

/** One part of the form, headed, as on the web app. */
function FormSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card style={{ gap: spacing.md }}>
      <View style={{ gap: 2 }}>
        <Text role="heading" {...level2} style={{ fontSize: 16, fontWeight: "700", color: colors.text }}>
          {title}
        </Text>
        {description ? <Text style={hintStyle}>{description}</Text> : null}
      </View>
      {children}
    </Card>
  );
}

/** Chips for one choice, named as a group so a screen reader says which choice each chip belongs to. */
function ChoiceField<T extends string>({
  label,
  options,
  value,
  onChange,
  allowEmpty,
  emptyLabel,
  error,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T | "";
  onChange: (v: T | "") => void;
  allowEmpty?: boolean;
  emptyLabel?: string;
  error?: string;
}) {
  return (
    <View role="group" aria-label={label.replace(/ \*$/, "")} style={{ gap: 4 }}>
      <ChipSelect tall label={label} options={options} value={value} onChange={onChange} allowEmpty={allowEmpty} emptyLabel={emptyLabel} />
      {error ? <Text style={errorStyle}>{error}</Text> : null}
    </View>
  );
}

/**
 * Posting or editing a job, in parts as on the web app: Basics, Requirements, Pay, About the role, Company and How to
 * apply. Every field a job has is here, so an edit sends them all. `slug` is for the logo's upload. `offerReferrals` shows
 * "I can refer people for this job", for a member who can use referrals now; otherwise the job keeps whatever it had, as
 * the API ignores the field then. `waitingReferrals` are the requests waiting for the poster's answer, which unticking it
 * would close.
 */
export function JobForm({
  slug,
  initial,
  submitLabel,
  onSubmit,
  offerReferrals = false,
  waitingReferrals = 0,
}: {
  slug: string;
  initial?: JobDto;
  submitLabel: string;
  onSubmit: (v: JobCreateInput) => Promise<void>;
  offerReferrals?: boolean;
  waitingReferrals?: number;
}) {
  const [v, setValues] = useState<Values>(() => defaults(initial));
  const set =
    <K extends keyof Values>(key: K) =>
    (value: Values[K]) =>
      setValues((prev) => ({ ...prev, [key]: value }));
  const [canRefer, setCanRefer] = useState(initial?.canRefer ?? false);
  const closesWaiting = offerReferrals && !!initial?.canRefer && waitingReferrals > 0 && !canRefer;
  // Said under Logo: Alert.alert shows nothing on the web export.
  const [logoError, setLogoError] = useState<string | null>(null);
  const upload = useImageUpload(slug, { onError: setLogoError });
  const skillsBox = useRef<SkillsInputHandle>(null);
  const { errors, serverError, busy, fromZod, run } = useFormErrors();
  const currency = v.salaryCurrency || "INR";
  // The pay as members will see it, so a missing or extra zero shows before posting.
  const payShown = formatSalary({ minMinor: payMinor(v.salaryMin, currency), maxMinor: payMinor(v.salaryMax, currency), currency, period: v.salaryPeriod || "YEAR" });
  const yearsShown = experienceLabel(previewYears(v.experienceMin), previewYears(v.experienceMax));
  const company: CompanyDetails = {
    companyLogoUrl: v.companyLogoUrl,
    companyWebsite: nul(v.companyWebsite),
    companyIndustry: v.companyIndustry || null,
    companySize: v.companySize || null,
    aboutCompany: nul(v.aboutCompany),
  };
  // The form is long, so the button says which fields need fixing, wherever they are above it.
  const wrong = Object.keys(errors)
    .map((key) => FIELD_LABELS[key as keyof JobCreateInput])
    .filter(Boolean);

  const submit = () =>
    run(async () => {
      // A skill still typed in the box counts, as it does on the web app, where pressing the button leaves the box first. On
      // a phone the box keeps focus through the tap, so it never adds the skill itself.
      const skills = skillsBox.current?.commit() ?? v.skills;
      const parsed = jobCreateSchema.safeParse(
        {
          ...toInput({ ...v, skills }),
          // Left out unless it was offered, so an edit never changes what the poster couldn't see, and on an edit unless they
          // changed it: a copy of the job read while referrals were off says false, which saving mustn't store.
          canRefer: offerReferrals && (!initial || canRefer !== initial.canRefer) ? canRefer : undefined,
        },
        { error: numberMessage },
      );
      if (!parsed.success) return fromZod(parsed.error);
      await onSubmit(parsed.data);
    });

  return (
    <>
      <FormSection title="Basics">
        <Input label="Job title *" value={v.title} onChangeText={set("title")} error={errors.title} />
        <Input label="Company *" value={v.companyName} onChangeText={set("companyName")} error={errors.companyName} />
        <ChoiceField label="Type *" options={JOB_TYPES.map((t) => ({ value: t, label: JOB_TYPE_LABELS[t] }))} value={v.jobType} onChange={set("jobType")} error={errors.jobType} />
        <ChoiceField label="Work mode" options={WORK_MODES.map((m) => ({ value: m, label: WORK_MODE_LABELS[m] }))} value={v.workMode} onChange={set("workMode")} error={errors.workMode} />
        <Input label="Location" value={v.location} onChangeText={set("location")} placeholder="City, country" error={errors.location} />
      </FormSection>

      <FormSection title="Requirements" description="All optional. Leave out what doesn't matter for this role.">
        <ChoiceField
          label="Seniority"
          options={JOB_SENIORITIES.map((s) => ({ value: s, label: JOB_SENIORITY_LABELS[s] }))}
          value={v.seniority}
          onChange={set("seniority")}
          allowEmpty
          emptyLabel="Not specified"
          error={errors.seniority}
        />
        <Row style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
          <View style={{ flex: 1 }}>
            <Input label="Minimum experience (years)" value={v.experienceMin} onChangeText={set("experienceMin")} keyboardType="number-pad" maxLength={2} error={errors.experienceMin} />
          </View>
          <View style={{ flex: 1 }}>
            <Input label="Maximum experience (years)" value={v.experienceMax} onChangeText={set("experienceMax")} keyboardType="number-pad" maxLength={2} error={errors.experienceMax} />
          </View>
        </Row>
        <Text style={hintStyle}>{yearsShown ? `Shows as: ${yearsShown}` : "Leave both empty if it doesn't matter. 0 with no maximum shows as “Open to freshers”."}</Text>
        <SkillsInput
          ref={skillsBox}
          label="Skills"
          value={v.skills}
          onChange={set("skills")}
          max={JOB_MAX_SKILLS}
          maxLength={JOB_SKILL_MAX_LENGTH}
          placeholder="e.g. Node.js, PostgreSQL"
          hint={`Press Return or type a comma after each one. Up to ${JOB_MAX_SKILLS}.`}
          error={errors.skills}
        />
        <Input label="Education" value={v.educationRequirement} onChangeText={set("educationRequirement")} placeholder="e.g. B.Tech, or the same experience" error={errors.educationRequirement} />
      </FormSection>

      <FormSection title="Pay" description="Optional. Type amounts in full: 2500000, not 25 L.">
        <ChoiceField label="Currency" options={SALARY_CURRENCIES.map((c) => ({ value: c, label: SALARY_CURRENCY_LABELS[c] }))} value={v.salaryCurrency} onChange={set("salaryCurrency")} error={errors.salaryCurrency} />
        <ChoiceField label="Pay period" options={SALARY_PERIODS.map((p) => ({ value: p, label: SALARY_PERIOD_LABELS[p] }))} value={v.salaryPeriod} onChange={set("salaryPeriod")} error={errors.salaryPeriod} />
        <Row style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
          <View style={{ flex: 1 }}>
            <Input label="Minimum pay" value={v.salaryMin} onChangeText={set("salaryMin")} keyboardType="decimal-pad" error={errors.salaryMinMinor} />
          </View>
          <View style={{ flex: 1 }}>
            <Input label="Maximum pay" value={v.salaryMax} onChangeText={set("salaryMax")} keyboardType="decimal-pad" error={errors.salaryMaxMinor} />
          </View>
        </Row>
        <View style={{ borderRadius: radius.md, backgroundColor: "#f8fafc", paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
          {payShown ? (
            <Text style={{ fontSize: 14, color: "#334155" }}>
              Shows as: <Text style={{ fontWeight: "700", color: colors.text }}>{payShown}</Text>
            </Text>
          ) : (
            <Text style={{ fontSize: 14, color: "#334155" }}>No amount: the job shows only its pay note, if it has one.</Text>
          )}
        </View>
        <Input label="Pay note" value={v.salaryNote} onChangeText={set("salaryNote")} placeholder="e.g. plus ESOPs" error={errors.salaryNote} />
        <Input label="Openings" value={v.openings} onChangeText={set("openings")} keyboardType="number-pad" maxLength={4} error={errors.openings} />
      </FormSection>

      <FormSection title="About the role">
        <Input label="About the role *" value={v.description} onChangeText={set("description")} multiline placeholder="What the role is, and the team it's in" hint={RICH_TEXT_HINT} error={errors.description} />
        <Input label="Responsibilities" value={v.responsibilities} onChangeText={set("responsibilities")} multiline placeholder={"- Design and run the service's APIs\n- Review code"} hint={RICH_TEXT_HINT} error={errors.responsibilities} />
        <Input label="Requirements" value={v.requirements} onChangeText={set("requirements")} multiline placeholder={"- 3+ years with Node.js\n- Solid SQL"} hint={RICH_TEXT_HINT} error={errors.requirements} />
        <Input label="Benefits" value={v.benefits} onChangeText={set("benefits")} multiline placeholder={"- Health cover\n- A learning budget"} hint={RICH_TEXT_HINT} error={errors.benefits} />
      </FormSection>

      <FormSection title="Company" description="Optional. Shown on the job's page under “About the company”.">
        <CompanyReuseOffer
          slug={slug}
          company={v.companyName}
          excludeId={initial?.id}
          current={company}
          onUse={(d) =>
            setValues((prev) => ({
              ...prev,
              companyLogoUrl: d.companyLogoUrl ?? prev.companyLogoUrl,
              companyWebsite: d.companyWebsite ?? prev.companyWebsite,
              companyIndustry: d.companyIndustry ?? prev.companyIndustry,
              companySize: d.companySize ?? prev.companySize,
              aboutCompany: d.aboutCompany ?? prev.aboutCompany,
            }))
          }
        />
        <View style={{ gap: 6 }}>
          <Text style={labelStyle}>Logo</Text>
          <Row>
            {v.companyLogoUrl && <CompanyLogo name={v.companyName} src={v.companyLogoUrl} />}
            <Button
              title={v.companyLogoUrl ? "Change logo" : "Add logo"}
              variant="outline"
              loading={upload.busy}
              onPress={async () => {
                setLogoError(null);
                const url = await upload.pickAndUpload();
                if (url) set("companyLogoUrl")(url);
              }}
            />
            {v.companyLogoUrl && <Button title="Remove logo" variant="ghost" onPress={() => set("companyLogoUrl")(null)} />}
          </Row>
          {errors.companyLogoUrl ? <Text style={errorStyle}>{errors.companyLogoUrl}</Text> : null}
          <ErrorText error={logoError} />
        </View>
        <Input label="Website" value={v.companyWebsite} onChangeText={set("companyWebsite")} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://" error={errors.companyWebsite} />
        {/* Too many industries for a row of chips, which would hide the chosen one off to the side: a list, as on the profile form. */}
        <OptionPicker
          label="Industry"
          value={v.companyIndustry || null}
          options={INDUSTRY_OPTIONS}
          onChange={(industry) => set("companyIndustry")(industry ?? "")}
          placeholder="Choose an industry"
          clearLabel="Not specified"
          error={errors.companyIndustry}
        />
        <ChoiceField
          label="Company size"
          options={COMPANY_SIZES.map((s) => ({ value: s, label: `${COMPANY_SIZE_LABELS[s]} employees` }))}
          value={v.companySize}
          onChange={set("companySize")}
          allowEmpty
          emptyLabel="Not specified"
          error={errors.companySize}
        />
        <Input label="About the company" value={v.aboutCompany} onChangeText={set("aboutCompany")} multiline placeholder="What the company does, and why someone would join" hint={RICH_TEXT_HINT} error={errors.aboutCompany} />
      </FormSection>

      <FormSection title="How to apply" description="Hidden once the job closes, or once applications close.">
        <Input label="Apply link" value={v.applyUrl} onChangeText={set("applyUrl")} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://" error={errors.applyUrl} />
        <Input label="Contact email" value={v.contactEmail} onChangeText={set("contactEmail")} autoCapitalize="none" keyboardType="email-address" error={errors.contactEmail} />
        <Input label="Contact phone" value={v.contactPhone} onChangeText={set("contactPhone")} keyboardType="phone-pad" error={errors.contactPhone} />
        <DateTimeField label="Applications close" mode="date" value={v.closes} onChange={set("closes")} minimumDate={new Date()} clearable error={errors.expiresAt} hint="Optional. The job is hidden from the board after this day." />
        <Input label="How to apply" value={v.howToApply} onChangeText={set("howToApply")} multiline placeholder="What to send, and what happens after" hint={RICH_TEXT_HINT} error={errors.howToApply} />
      </FormSection>

      {offerReferrals && (
        <View style={{ gap: 6 }}>
          <Choice kind="checkbox" label={CAN_REFER_LABEL} checked={canRefer} hint={CAN_REFER_HELP} onPress={() => setCanRefer((on) => !on)} />
          <Text style={hintStyle}>{CAN_REFER_HELP}</Text>
          {closesWaiting && (
            <Text role="alert" style={{ fontSize: 12, color: "#92400e" }}>
              {waitingReferralsCloseText(waitingReferrals)}
            </Text>
          )}
        </View>
      )}
      <ErrorText error={wrong.length ? `Check ${wrong.join(", ")} above.` : null} />
      <ErrorText error={serverError} />
      {/* A logo still uploading holds the button, so the job isn't saved without it. */}
      <Button title={upload.busy ? "Uploading logo…" : submitLabel} onPress={() => void submit()} loading={busy} disabled={upload.busy} />
    </>
  );
}
