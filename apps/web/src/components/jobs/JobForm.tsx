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
import { isApiClientError } from "@illuminize/shared/client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useId, useMemo, useState, type ReactNode } from "react";
import { Controller, useForm, useWatch, type Resolver } from "react-hook-form";
import { ImageUploader } from "@/components/common/ImageUploader";
import { SkillsInput } from "@/components/common/SkillsInput";
import { CompanyLogo } from "@/components/jobs/CompanyLogo";
import { CompanyReuseOffer } from "@/components/jobs/CompanyReuse";
import { Button, Checkbox, ErrorBox, FormField, Input, Select, Textarea } from "@/components/ui";

/**
 * What the form edits. Years, openings and pay are typed as text and pay in major units (rupees, dollars); they become
 * numbers, and pay minor units, only when the form is validated, as in the funding form.
 */
interface JobFormValues {
  title: string;
  companyName: string;
  jobType: JobType;
  workMode: WorkMode;
  location: string | null;
  seniority: JobSeniority | null;
  experienceMin: string;
  experienceMax: string;
  skills: string[];
  educationRequirement: string | null;
  salaryCurrency: SalaryCurrency;
  salaryPeriod: SalaryPeriod;
  salaryMin: string;
  salaryMax: string;
  salaryNote: string | null;
  openings: string;
  description: string;
  responsibilities: string | null;
  requirements: string | null;
  benefits: string | null;
  companyLogoUrl: string | null;
  companyWebsite: string | null;
  companyIndustry: Industry | null;
  companySize: CompanySize | null;
  aboutCompany: string | null;
  applyUrl: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  howToApply: string | null;
  expiresAt: string | null;
  canRefer: boolean;
}

/** The fields the form edits under another name than the API's, so each error lands on its own input. */
const FORM_FIELD_FOR: Partial<Record<string, keyof JobFormValues>> = { salaryMinMinor: "salaryMin", salaryMaxMinor: "salaryMax" };
/** "skills.3" (one skill too long) is the skills box's error. */
const formField = (path: string) => {
  const root = path.split(".")[0]!;
  return (FORM_FIELD_FOR[root] ?? root) as keyof JobFormValues;
};

/** Each field's name as the form shows it, for the line by the button that says which ones need fixing, as on the mobile app. */
const FIELD_LABELS: Partial<Record<keyof JobFormValues, string>> = {
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
  salaryMin: "Minimum pay",
  salaryMax: "Maximum pay",
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

/** "YYYY-MM-DD" in the viewer's zone for an instant, for <input type="date">. */
function toLocalDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The closing date means "open until the end of that day" where the poster is. */
function endOfLocalDay(date: string): string {
  const d = new Date(`${date}T23:59:59`);
  return Number.isNaN(d.getTime()) ? date : d.toISOString();
}

/** A number typed in a box: null when it's empty, NaN when it isn't a number, which validation refuses. */
function typedNumber(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : Number.NaN;
}

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

/** What the API takes, from what the form holds. */
function toInput(v: JobFormValues): Record<string, unknown> {
  const { salaryMin, salaryMax, experienceMin, experienceMax, openings, expiresAt, ...rest } = v;
  return {
    ...rest,
    experienceMin: typedNumber(experienceMin),
    experienceMax: typedNumber(experienceMax),
    openings: typedNumber(openings),
    salaryMinMinor: payMinor(salaryMin, rest.salaryCurrency),
    salaryMaxMinor: payMinor(salaryMax, rest.salaryCurrency),
    expiresAt: expiresAt ? endOfLocalDay(expiresAt) : null,
  };
}

function defaults(initial: JobDto | undefined): JobFormValues {
  const currency = initial?.salaryCurrency ?? "INR";
  const major = (minor: number | null | undefined) => (minor == null ? "" : String(toMajor(minor, currency)));
  return {
    title: initial?.title ?? "",
    companyName: initial?.companyName ?? "",
    jobType: initial?.jobType ?? "FULL_TIME",
    workMode: initial?.workMode ?? "ON_SITE",
    location: initial?.location ?? null,
    seniority: initial?.seniority ?? null,
    experienceMin: numberText(initial?.experienceMin),
    experienceMax: numberText(initial?.experienceMax),
    skills: initial?.skills ?? [],
    educationRequirement: initial?.educationRequirement ?? null,
    salaryCurrency: currency,
    salaryPeriod: initial?.salaryPeriod ?? "YEAR",
    salaryMin: major(initial?.salaryMinMinor),
    salaryMax: major(initial?.salaryMaxMinor),
    salaryNote: initial?.salaryNote ?? null,
    openings: numberText(initial?.openings),
    description: initial?.description ?? "",
    responsibilities: initial?.responsibilities ?? null,
    requirements: initial?.requirements ?? null,
    benefits: initial?.benefits ?? null,
    companyLogoUrl: initial?.companyLogoUrl ?? null,
    companyWebsite: initial?.companyWebsite ?? null,
    companyIndustry: initial?.companyIndustry ?? null,
    companySize: initial?.companySize ?? null,
    aboutCompany: initial?.aboutCompany ?? null,
    applyUrl: initial?.applyUrl ?? null,
    contactEmail: initial?.contactEmail ?? null,
    contactPhone: initial?.contactPhone ?? null,
    howToApply: initial?.howToApply ?? null,
    expiresAt: toLocalDate(initial?.expiresAt),
    canRefer: initial?.canRefer ?? false,
  };
}

/** One part of the form, headed, with its fields in two columns from a tablet up. `before` goes between the heading and them. */
function FormSection({ title, description, before, children }: { title: string; description?: string; before?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="border-t border-slate-100 pt-5 first:border-t-0 first:pt-0">
      <h2 id={id} className="font-display text-base font-semibold text-slate-900">
        {title}
      </h2>
      {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
      {before}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

const Wide = ({ children }: { children: ReactNode }) => <div className="sm:col-span-2">{children}</div>;

/**
 * Posting or editing a job, in parts: Basics, Requirements, Pay, About the role, Company and How to apply. Every field a
 * job has is here, so an edit sends them all. `offerReferrals` shows "I can refer people for this job", for a member who
 * can use referrals now; otherwise the job keeps whatever it had, as the API ignores the field then. `waitingReferrals`
 * are the requests waiting for the poster's answer, which unticking it would close.
 */
export function JobForm({
  slug,
  initial,
  onSubmit,
  submitLabel,
  offerReferrals = false,
  waitingReferrals = 0,
}: {
  slug: string;
  initial?: JobDto;
  onSubmit: (v: JobCreateInput) => Promise<void>;
  submitLabel: string;
  offerReferrals?: boolean;
  waitingReferrals?: number;
}) {
  const [serverError, setServerError] = useState<unknown>(null);
  // A logo still uploading holds the button, so the job isn't saved without it.
  const [logoBusy, setLogoBusy] = useState(false);
  const referId = useId();
  const skillsId = useId();
  const yearsId = useId();
  const payId = useId();
  const resolver = useMemo<Resolver<JobFormValues, unknown, JobCreateInput>>(() => {
    const zod = zodResolver(jobCreateSchema) as unknown as Resolver<Record<string, unknown>, unknown, JobCreateInput>;
    return async (values, context, options) => {
      const result = await zod(toInput(values), context, options as never);
      const errors: Record<string, unknown> = {};
      // A skill's own error comes as a list with one place per skill; the box shows the first.
      for (const [path, error] of Object.entries(result.errors)) errors[formField(path)] = Array.isArray(error) ? error.find(Boolean) : error;
      return { values: result.values, errors } as never;
    };
  }, []);
  const { register, handleSubmit, formState, setError, setValue, control } = useForm<JobFormValues, unknown, JobCreateInput>({ resolver, defaultValues: defaults(initial) });
  const e = formState.errors as Partial<Record<keyof JobFormValues, { message?: string }>>;
  const nullable = { setValueAs: (v: string) => (v ? v : null) };
  const offered = useWatch({ control, name: "canRefer" });
  const closesWaiting = offerReferrals && !!initial?.canRefer && waitingReferrals > 0 && !offered;
  const [salaryCurrency, salaryPeriod, salaryMin, salaryMax, experienceMin, experienceMax, companyName] = useWatch({
    control,
    name: ["salaryCurrency", "salaryPeriod", "salaryMin", "salaryMax", "experienceMin", "experienceMax", "companyName"],
  });
  const [companyLogoUrl, companyWebsite, companyIndustry, companySize, aboutCompany] = useWatch({
    control,
    name: ["companyLogoUrl", "companyWebsite", "companyIndustry", "companySize", "aboutCompany"],
  });
  const company: CompanyDetails = { companyLogoUrl, companyWebsite, companyIndustry, companySize, aboutCompany };
  // The pay as members will see it, so a missing or extra zero shows before posting.
  const payShown = formatSalary({ minMinor: payMinor(salaryMin, salaryCurrency), maxMinor: payMinor(salaryMax, salaryCurrency), currency: salaryCurrency, period: salaryPeriod });
  const yearsShown = experienceLabel(previewYears(experienceMin), previewYears(experienceMax));
  // From today, or from the day a job being edited already closed on, so it still saves as it is; the mobile app's picker
  // likewise only stops a new day in the past.
  const today = toLocalDate(new Date().toISOString()) ?? undefined;
  const closedOn = toLocalDate(initial?.expiresAt);
  const closesFrom = closedOn && today && closedOn < today ? closedOn : today;
  // The form is long, so by the button it says which fields need fixing, wherever they are above it, as on the mobile app.
  const wrong = Object.keys(formState.errors)
    .map((key) => FIELD_LABELS[key as keyof JobFormValues])
    .filter(Boolean);

  return (
    <form
      className="space-y-6"
      onSubmit={handleSubmit(async (v) => {
        setServerError(null);
        try {
          // Left out unless it was offered, so an edit never changes what the poster couldn't see, and on an edit unless they
          // changed it: a copy of the job read while referrals were off says false, which saving mustn't store.
          const sendRefer = offerReferrals && (!initial || v.canRefer !== initial.canRefer);
          await onSubmit(sendRefer ? v : { ...v, canRefer: undefined });
        } catch (err) {
          if (isApiClientError(err) && Object.keys(err.fieldErrors).length) {
            // Focus goes to the first, as it does for the form's own checks.
            Object.entries(err.fieldErrors).forEach(([p, m], i) => setError(formField(p), { message: m }, { shouldFocus: i === 0 }));
          } else setServerError(err);
        }
      })}
    >
      <FormSection title="Basics">
        <Wide>
          <FormField label="Job title" required error={e.title?.message}>
            <Input {...register("title")} invalid={!!e.title} />
          </FormField>
        </Wide>
        <FormField label="Company" required error={e.companyName?.message}>
          <Input {...register("companyName")} invalid={!!e.companyName} />
        </FormField>
        <FormField label="Type" required error={e.jobType?.message}>
          <Select {...register("jobType")}>
            {JOB_TYPES.map((t) => (
              <option key={t} value={t}>
                {JOB_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Work mode" error={e.workMode?.message}>
          <Select {...register("workMode")}>
            {WORK_MODES.map((m) => (
              <option key={m} value={m}>
                {WORK_MODE_LABELS[m]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Location" error={e.location?.message}>
          <Input {...register("location", nullable)} placeholder="City, country" />
        </FormField>
      </FormSection>

      <FormSection title="Requirements" description="All optional. Leave out what doesn't matter for this role.">
        <Wide>
          {/* A column wide, as the fields below it are, on a row of its own: the fields come in the mobile app's order. */}
          <FormField label="Seniority" error={e.seniority?.message}>
            <Select {...register("seniority", nullable)} className="sm:w-[calc(50%-0.5rem)]">
              <option value="">Not specified</option>
              {JOB_SENIORITIES.map((s) => (
                <option key={s} value={s}>
                  {JOB_SENIORITY_LABELS[s]}
                </option>
              ))}
            </Select>
          </FormField>
        </Wide>
        <FormField label="Minimum experience (years)" error={e.experienceMin?.message}>
          <Input type="number" min={0} max={JOB_EXPERIENCE_MAX_YEARS} inputMode="numeric" aria-describedby={yearsId} {...register("experienceMin")} invalid={!!e.experienceMin} />
        </FormField>
        <FormField label="Maximum experience (years)" error={e.experienceMax?.message}>
          <Input type="number" min={0} max={JOB_EXPERIENCE_MAX_YEARS} inputMode="numeric" aria-describedby={yearsId} {...register("experienceMax")} invalid={!!e.experienceMax} />
        </FormField>
        <Wide>
          <p id={yearsId} className="-mt-2 text-xs text-slate-500">
            {yearsShown ? `Shows as: ${yearsShown}` : "Leave both empty if it doesn't matter. 0 with no maximum shows as “Open to freshers”."}
          </p>
        </Wide>
        <Wide>
          <FormField label="Skills" htmlFor={skillsId} error={e.skills?.message} hint={`Press Enter or type a comma after each one. Up to ${JOB_MAX_SKILLS}.`}>
            <Controller
              control={control}
              name="skills"
              render={({ field }) => (
                <SkillsInput
                  id={skillsId}
                  aria-describedby={`${skillsId}-desc`}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  max={JOB_MAX_SKILLS}
                  maxLength={JOB_SKILL_MAX_LENGTH}
                  invalid={!!e.skills}
                  placeholder="e.g. Node.js, PostgreSQL"
                />
              )}
            />
          </FormField>
        </Wide>
        <Wide>
          <FormField label="Education" error={e.educationRequirement?.message}>
            <Input {...register("educationRequirement", nullable)} placeholder="e.g. B.Tech, or the same experience" invalid={!!e.educationRequirement} />
          </FormField>
        </Wide>
      </FormSection>

      <FormSection title="Pay" description="Optional. Type amounts in full: 2500000, not 25 L.">
        <FormField label="Currency" error={e.salaryCurrency?.message}>
          <Select {...register("salaryCurrency")}>
            {SALARY_CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {SALARY_CURRENCY_LABELS[c]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Pay period" error={e.salaryPeriod?.message}>
          <Select {...register("salaryPeriod")}>
            {SALARY_PERIODS.map((p) => (
              <option key={p} value={p}>
                {SALARY_PERIOD_LABELS[p]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Minimum pay" error={e.salaryMin?.message}>
          <Input type="number" min={0} step="any" inputMode="decimal" aria-describedby={payId} {...register("salaryMin")} invalid={!!e.salaryMin} />
        </FormField>
        <FormField label="Maximum pay" error={e.salaryMax?.message}>
          <Input type="number" min={0} step="any" inputMode="decimal" aria-describedby={payId} {...register("salaryMax")} invalid={!!e.salaryMax} />
        </FormField>
        <Wide>
          <p id={payId} className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
            {payShown ? (
              <>
                Shows as: <strong className="font-semibold text-slate-900">{payShown}</strong>
              </>
            ) : (
              "No amount: the job shows only its pay note, if it has one."
            )}
          </p>
        </Wide>
        <FormField label="Pay note" error={e.salaryNote?.message}>
          <Input {...register("salaryNote", nullable)} placeholder="e.g. plus ESOPs" />
        </FormField>
        <FormField label="Openings" error={e.openings?.message}>
          <Input type="number" min={1} max={1000} inputMode="numeric" {...register("openings")} invalid={!!e.openings} />
        </FormField>
      </FormSection>

      <FormSection title="About the role">
        <Wide>
          <FormField label="About the role" required error={e.description?.message} hint={RICH_TEXT_HINT}>
            <Textarea {...register("description")} rows={6} invalid={!!e.description} placeholder="What the role is, and the team it's in" />
          </FormField>
        </Wide>
        <Wide>
          <FormField label="Responsibilities" error={e.responsibilities?.message} hint={RICH_TEXT_HINT}>
            <Textarea {...register("responsibilities", nullable)} rows={4} invalid={!!e.responsibilities} placeholder={"- Design and run the service's APIs\n- Review code"} />
          </FormField>
        </Wide>
        <Wide>
          <FormField label="Requirements" error={e.requirements?.message} hint={RICH_TEXT_HINT}>
            <Textarea {...register("requirements", nullable)} rows={4} invalid={!!e.requirements} placeholder={"- 3+ years with Node.js\n- Solid SQL"} />
          </FormField>
        </Wide>
        <Wide>
          <FormField label="Benefits" error={e.benefits?.message} hint={RICH_TEXT_HINT}>
            <Textarea {...register("benefits", nullable)} rows={3} invalid={!!e.benefits} placeholder={"- Health cover\n- A learning budget"} />
          </FormField>
        </Wide>
      </FormSection>

      <FormSection
        title="Company"
        description="Optional. Shown on the job's page under “About the company”."
        before={
          <CompanyReuseOffer
            slug={slug}
            company={companyName}
            excludeId={initial?.id}
            current={company}
            onUse={(details) => {
              for (const [key, value] of Object.entries(details)) setValue(key as keyof CompanyDetails, value as never, { shouldDirty: true });
            }}
          />
        }
      >
        <Wide>
          <FormField label="Logo" group error={e.companyLogoUrl?.message}>
            {/* As on the mobile app: the logo as the job will show it, with buttons to change or remove it. */}
            <Controller
              control={control}
              name="companyLogoUrl"
              render={({ field }) => (
                <div className="flex flex-wrap items-center gap-2">
                  {field.value && <CompanyLogo name={companyName} src={field.value} />}
                  <ImageUploader
                    slug={slug}
                    urls={[]}
                    onChange={(u) => field.onChange(u[0] ?? null)}
                    label={field.value ? "Change logo" : "Add logo"}
                    showPreviews={false}
                    triggerClassName="min-h-11"
                    onBusyChange={setLogoBusy}
                  />
                  {field.value && (
                    <Button type="button" variant="ghost" size="sm" className="min-h-11" onClick={() => field.onChange(null)}>
                      Remove logo
                    </Button>
                  )}
                </div>
              )}
            />
          </FormField>
        </Wide>
        <FormField label="Website" error={e.companyWebsite?.message}>
          <Input {...register("companyWebsite", nullable)} placeholder="https://" invalid={!!e.companyWebsite} />
        </FormField>
        <FormField label="Industry" error={e.companyIndustry?.message}>
          <Select {...register("companyIndustry", nullable)}>
            <option value="">Not specified</option>
            {INDUSTRIES.map((i) => (
              <option key={i} value={i}>
                {INDUSTRY_LABELS[i]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Company size" error={e.companySize?.message}>
          <Select {...register("companySize", nullable)}>
            <option value="">Not specified</option>
            {COMPANY_SIZES.map((s) => (
              <option key={s} value={s}>
                {`${COMPANY_SIZE_LABELS[s]} employees`}
              </option>
            ))}
          </Select>
        </FormField>
        <Wide>
          <FormField label="About the company" error={e.aboutCompany?.message} hint={RICH_TEXT_HINT}>
            <Textarea {...register("aboutCompany", nullable)} rows={3} invalid={!!e.aboutCompany} placeholder="What the company does, and why someone would join" />
          </FormField>
        </Wide>
      </FormSection>

      <FormSection title="How to apply" description="Hidden once the job closes, or once applications close.">
        <FormField label="Apply link" error={e.applyUrl?.message}>
          <Input {...register("applyUrl", nullable)} placeholder="https://" invalid={!!e.applyUrl} />
        </FormField>
        <FormField label="Contact email" error={e.contactEmail?.message}>
          <Input type="email" {...register("contactEmail", nullable)} invalid={!!e.contactEmail} />
        </FormField>
        <FormField label="Contact phone" error={e.contactPhone?.message}>
          <Input type="tel" {...register("contactPhone", nullable)} invalid={!!e.contactPhone} />
        </FormField>
        <FormField label="Applications close" hint="Optional. The job is hidden from the board after this day." error={e.expiresAt?.message}>
          <Input type="date" min={closesFrom} {...register("expiresAt", nullable)} />
        </FormField>
        <Wide>
          <FormField label="How to apply" error={e.howToApply?.message} hint={RICH_TEXT_HINT}>
            <Textarea {...register("howToApply", nullable)} rows={3} invalid={!!e.howToApply} placeholder="What to send, and what happens after" />
          </FormField>
        </Wide>
      </FormSection>

      {offerReferrals && (
        <div className="rounded-lg border border-slate-200 px-3 py-1">
          <Checkbox {...register("canRefer")} label={CAN_REFER_LABEL} aria-describedby={`${referId}-help${closesWaiting ? ` ${referId}-closes` : ""}`} className="min-h-11 font-medium" />
          <p id={`${referId}-help`} className="pb-2 text-xs text-slate-500">
            {CAN_REFER_HELP}
          </p>
          {closesWaiting && (
            // Said as it appears, as on the mobile app: unticking is what brings it up.
            <p id={`${referId}-closes`} role="alert" className="pb-2 text-xs text-amber-800">
              {waitingReferralsCloseText(waitingReferrals)}
            </p>
          )}
        </div>
      )}
      {wrong.length > 0 && <p className="text-sm font-medium text-red-600">Check {wrong.join(", ")} above.</p>}
      {serverError ? <ErrorBox error={serverError} /> : null}
      <Button type="submit" loading={formState.isSubmitting} disabled={logoBusy}>
        {logoBusy ? "Uploading logo…" : submitLabel}
      </Button>
    </form>
  );
}
