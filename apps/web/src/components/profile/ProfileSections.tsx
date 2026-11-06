import {
  INDUSTRIES,
  INDUSTRY_LABELS,
  MARITAL_STATUSES,
  MARITAL_STATUS_LABELS,
  OPEN_TO,
  OPEN_TO_LABELS,
  PROFESSION_TYPES,
  PROFESSION_TYPE_LABELS,
  PROFILE_DEGREE_MAX_LENGTH,
  PROFILE_HEADLINE_MAX_LENGTH,
  PROFILE_MAX_SKILLS,
  RICH_TEXT_HINT,
  SKILL_MAX_LENGTH,
  memberEndYearOptions,
  memberStartYearOptions,
  memberYearFields,
  mentorshipAvailable,
  mentorshipKeys,
  socialUrlFromInput,
  type ProfileLinkKey,
  type SocialLinkKind,
} from "@illuminize/shared";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import type { ReactNode } from "react";
import { Controller } from "react-hook-form";
import { Link } from "react-router-dom";
import { CommaListInput } from "@/components/common/CommaListInput";
import { CountrySelect } from "@/components/common/CountrySelect";
import { SkillsInput } from "@/components/common/SkillsInput";
import { IconCheck, IconChevronDown } from "@/components/icons";
import { AvatarPicker } from "@/components/profile/AvatarPicker";
import { CustomFieldInputs } from "@/components/profile/CustomFieldInputs";
import { EducationListInput, ExperienceListInput } from "@/components/profile/HistoryListInputs";
import { errorMessageOf, pastYears, yearValue, type ProfileFormController } from "@/components/profile/useProfileForm";
import { Checkbox, FormField, Input, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { mentorsPath } from "@/lib/mentors";

const blankIsNull = (v: unknown) => (v ? v : null);

function SubHeading({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-3">
      <h3 className="text-sm font-semibold text-slate-900">{children}</h3>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

/**
 * A disclosure's summary as a full-width row at least 44 pixels tall, with a chevron that turns over while its own
 * <details> is open (not one it sits inside). Its content goes in a `px-4 pb-4` box after it.
 */
export function DisclosureSummary({ children }: { children: ReactNode }) {
  return (
    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-4 text-sm font-medium text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 [&::-webkit-details-marker]:hidden">
      <span>{children}</span>
      <IconChevronDown size={18} className="text-slate-400 transition-transform [[open]>summary>&]:rotate-180" />
    </summary>
  );
}

/** Photo, name, years here, what they do, date of birth, where they live, and every question registration requires. */
export function ProfileBasicsSection({ form: f }: { form: ProfileFormController }) {
  const { register, control, formState, clearErrors } = f.form;
  const errors = formState.errors;
  const years = memberYearFields(f.tenant.type);
  return (
    <div className="space-y-5">
      <Controller
        control={control}
        name="avatarUrl"
        render={({ field, fieldState }) => (
          <AvatarPicker
            slug={f.tenant.slug}
            name={f.fullName ?? ""}
            value={field.value ?? null}
            error={fieldState.error?.message}
            onBusyChange={f.setPhotoBusy}
            onChange={(url) => {
              field.onChange(url);
              clearErrors("avatarUrl");
            }}
          />
        )}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {/* A blank name says what's missing rather than the schema's "Too small". */}
        <div className="sm:col-span-2">
          <FormField label="Full name" required error={errors.fullName && (errors.fullName.type === "too_small" ? "Enter your full name" : errors.fullName.message)}>
            <Input {...register("fullName")} invalid={!!errors.fullName} aria-invalid={!!errors.fullName || undefined} autoComplete="name" />
          </FormField>
        </div>
        {/* Blank until picked, so nobody is given years they never chose. A community's blank end means they still belong. */}
        <FormField label={years.start.label} required error={errors.startYear?.message}>
          <Select {...register("startYear", { setValueAs: yearValue })} invalid={!!errors.startYear} aria-invalid={!!errors.startYear || undefined}>
            <option value="">{years.start.blank}</option>
            {memberStartYearOptions().map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={years.end.label} required={years.end.required} error={errors.batchYear?.message}>
          <Select {...register("batchYear", { setValueAs: yearValue })} invalid={!!errors.batchYear} aria-invalid={!!errors.batchYear || undefined}>
            <option value="">{years.end.blank}</option>
            {memberEndYearOptions(f.tenant).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="What do you do?" required error={errors.professionType?.message}>
          <Select {...register("professionType")}>
            {PROFESSION_TYPES.map((p) => (
              <option key={p} value={p}>
                {PROFESSION_TYPE_LABELS[p]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Date of birth" error={errors.dateOfBirth?.message}>
          <Input type="date" {...register("dateOfBirth", { setValueAs: blankIsNull })} invalid={!!errors.dateOfBirth} aria-invalid={!!errors.dateOfBirth || undefined} />
        </FormField>
        <FormField label="Current city" error={errors.city?.message}>
          <Input {...register("city")} autoComplete="address-level2" invalid={!!errors.city} aria-invalid={!!errors.city || undefined} />
        </FormField>
        <FormField label="Country" error={errors.country?.message}>
          <CountrySelect {...register("country", { setValueAs: blankIsNull })} />
        </FormField>
        <CustomFieldInputs fields={f.required} values={f.answers} errors={f.answerErrors} onChange={f.setAnswer} />
      </div>
    </div>
  );
}

/** The headline, the current role, industry, when they started working, skills and past roles. */
export function ProfileWorkSection({ form: f }: { form: ProfileFormController }) {
  const { register, control, formState } = f.form;
  const errors = formState.errors;
  const profession = f.professionType;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <FormField label="Headline" hint="One line under your name, such as “Product designer at Zylo Labs”." error={errors.headline?.message}>
          <Input
            {...register("headline")}
            maxLength={PROFILE_HEADLINE_MAX_LENGTH}
            invalid={!!errors.headline}
            aria-invalid={!!errors.headline || undefined}
            placeholder="What you do, in a line"
          />
        </FormField>
      </div>
      <FormField label={profession === "STUDENT" ? "Institution" : profession === "EMPLOYED" ? "Company" : "Company / business"} error={errors.companyName?.message}>
        <Input {...register("companyName")} placeholder={profession === "FOUNDER" ? "Your startup" : "Where you work"} aria-invalid={!!errors.companyName || undefined} />
      </FormField>
      <FormField label="Designation / role" error={errors.designation?.message}>
        <Input {...register("designation")} aria-invalid={!!errors.designation || undefined} />
      </FormField>
      <FormField label="Industry" error={errors.industry?.message}>
        <Select {...register("industry", { setValueAs: blankIsNull })}>
          <option value="">Choose your industry</option>
          {INDUSTRIES.map((i) => (
            <option key={i} value={i}>
              {INDUSTRY_LABELS[i]}
            </option>
          ))}
        </Select>
      </FormField>
      {/* A student hasn't started working yet; the year stays as it was if they switch back. */}
      {profession !== "STUDENT" && (
        <FormField label="Year you started working" hint="Your profile shows your years of experience from it." error={errors.careerStartYear?.message}>
          <Select {...register("careerStartYear", { setValueAs: yearValue })} invalid={!!errors.careerStartYear} aria-invalid={!!errors.careerStartYear || undefined}>
            <option value="">Choose a year</option>
            {pastYears().map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </FormField>
      )}
      <div className="sm:col-span-2">
        <Controller
          control={control}
          name="skills"
          render={({ field, fieldState }) => (
            <FormField
              htmlFor="profile-skills"
              label="Skills"
              hint={`What you're good at professionally, such as SQL, sales or design. Press Enter or type a comma after each, up to ${PROFILE_MAX_SKILLS}.`}
              error={errorMessageOf(fieldState.error)}
            >
              <SkillsInput
                id="profile-skills"
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                max={PROFILE_MAX_SKILLS}
                maxLength={SKILL_MAX_LENGTH}
                invalid={!!fieldState.error}
                placeholder="Add a skill"
                aria-describedby="profile-skills-desc"
              />
            </FormField>
          )}
        />
      </div>
      <div className="sm:col-span-2">
        <ExperienceListInput key={f.version} form={f} />
      </div>
    </div>
  );
}

const LINK_FIELDS: Array<{ name: ProfileLinkKey; kind: SocialLinkKind; label: string; placeholder: string }> = [
  { name: "linkedinUrl", kind: "linkedin", label: "LinkedIn", placeholder: "linkedin.com/in/your-name" },
  { name: "websiteUrl", kind: "website", label: "Website", placeholder: "yourname.com" },
  { name: "githubUrl", kind: "github", label: "GitHub", placeholder: "@username" },
  { name: "instagramUrl", kind: "instagram", label: "Instagram", placeholder: "@username" },
  { name: "xUrl", kind: "x", label: "X", placeholder: "@username" },
];

/**
 * "Offer to mentor", for a member who can mentor here and doesn't yet: mentoring is a profile of its own, in Mentors.
 * Going there leaves this page, which would lose what's typed and not saved, so until it's saved it only says so.
 */
function OfferToMentor({ form: f }: { form: ProfileFormController }) {
  const slug = f.tenant.slug;
  const available = f.mode === "edit" && mentorshipAvailable(f.tenant.settings.features, f.initial?.chatEligible ?? false);
  const mine = useQuery({ queryKey: mentorshipKeys.me(slug), queryFn: () => api.mentorship.me(slug), enabled: available, staleTime: 60_000 });
  if (!available || !mine.isSuccess || mine.data?.isActive) return null;
  return (
    <p className="mt-3 text-sm text-slate-600">
      Happy to guide other members?{" "}
      {f.dirty ? (
        "Save your profile, then you can offer to mentor."
      ) : (
        <Link to={mentorsPath(slug, "be-a-mentor")} className="font-medium text-primary underline">
          Offer to mentor
        </Link>
      )}
    </p>
  );
}

/**
 * Bio and interests, studies here and elsewhere, links and Open to (neither for a current pupil), the optional questions,
 * personal details behind a disclosure, and the sharing switches.
 */
export function ProfileAboutSection({ form: f }: { form: ProfileFormController }) {
  const { register, control, formState, setValue } = f.form;
  const errors = formState.errors;
  const school = f.tenant.type === "SCHOOL";
  return (
    <div className="space-y-6">
      <div className="grid gap-4">
        <FormField label="Short bio" error={errors.bio?.message} hint={RICH_TEXT_HINT}>
          <Textarea {...register("bio")} placeholder="Tell your batchmates what you're up to" maxLength={1000} aria-invalid={!!errors.bio || undefined} />
        </FormField>
        <FormField label="Interests" hint="What you enjoy outside work, such as cricket, startups or travel. Separate them with commas." error={errorMessageOf(errors.interests)}>
          <Controller
            control={control}
            name="interests"
            render={({ field }) => <CommaListInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} max={20} placeholder="cricket, startups, travel" />}
          />
        </FormField>
      </div>

      {!school && (
        <div>
          <SubHeading>Your studies at {f.tenant.shortName ?? f.tenant.name}</SubHeading>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Degree" error={errors.degree?.message}>
              <Input {...register("degree")} maxLength={PROFILE_DEGREE_MAX_LENGTH} placeholder="e.g. B.Tech" aria-invalid={!!errors.degree || undefined} />
            </FormField>
            <FormField label="Field of study" error={errors.fieldOfStudy?.message}>
              <Input {...register("fieldOfStudy")} maxLength={PROFILE_DEGREE_MAX_LENGTH} placeholder="e.g. Mechanical engineering" aria-invalid={!!errors.fieldOfStudy || undefined} />
            </FormField>
          </div>
        </div>
      )}

      <EducationListInput key={f.version} form={f} />

      {!f.pupil && (
        <div>
          <SubHeading hint="A full address, or for LinkedIn, GitHub, Instagram and X just your user name.">Links</SubHeading>
          <div className="grid gap-4 sm:grid-cols-2">
            {LINK_FIELDS.map((l) => (
              <FormField key={l.name} label={l.label} error={errors[l.name]?.message}>
                <Input
                  {...register(l.name, {
                    // A handle or an address without https:// becomes the full address, both when it's sent and as they leave the box.
                    setValueAs: (v: string | null) => socialUrlFromInput(l.kind, v),
                    onBlur: (e: { target: { value: string } }) => setValue(l.name, socialUrlFromInput(l.kind, e.target.value)),
                  })}
                  inputMode="url"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder={l.placeholder}
                  invalid={!!errors[l.name]}
                  aria-invalid={!!errors[l.name] || undefined}
                />
              </FormField>
            ))}
          </div>
        </div>
      )}

      {!f.pupil && (
        <div>
          <Controller
            control={control}
            name="openTo"
            render={({ field }) => {
              const chosen = field.value ?? [];
              return (
                <FormField label="Open to" group hint="Shown on your profile and your directory card, where members can filter by it.">
                  <div className="flex flex-wrap gap-2 pt-1">
                    {OPEN_TO.map((o) => {
                      const on = chosen.includes(o);
                      return (
                        <button
                          key={o}
                          type="button"
                          aria-pressed={on}
                          onClick={() => field.onChange(on ? chosen.filter((x) => x !== o) : [...chosen, o])}
                          className={clsx(
                            "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                            on ? "border-primary bg-primary text-on-primary" : "border-slate-300 bg-white text-slate-700 hover:border-slate-400",
                          )}
                        >
                          {on && <IconCheck size={16} />}
                          {OPEN_TO_LABELS[o]}
                        </button>
                      );
                    })}
                  </div>
                </FormField>
              );
            }}
          />
          <OfferToMentor form={f} />
        </div>
      )}

      {f.optional.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          <CustomFieldInputs fields={f.optional} values={f.answers} errors={f.answerErrors} onChange={f.setAnswer} readOnly={f.readOnly} />
        </div>
      )}

      <details className="rounded-lg border border-slate-200" open={f.personalOpen} onToggle={(e) => f.setPersonalOpen(e.currentTarget.open)}>
        <DisclosureSummary>Personal</DisclosureSummary>
        <div className="px-4 pb-4">
          <p className="text-xs text-slate-500">Only you and your institution's admins see these.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <FormField label="Marital status" error={errors.maritalStatus?.message}>
              <Select {...register("maritalStatus", { setValueAs: blankIsNull })}>
                <option value="">Prefer not to say</option>
                {MARITAL_STATUSES.map((m) => (
                  <option key={m} value={m}>
                    {MARITAL_STATUS_LABELS[m]}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Number of kids" error={errors.kidsCount?.message}>
              <Input
                type="number"
                min={0}
                max={20}
                {...register("kidsCount", { setValueAs: (v) => (v === "" || v === null ? null : Number(v)) })}
                aria-invalid={!!errors.kidsCount || undefined}
              />
            </FormField>
          </div>
        </div>
      </details>

      <div className="space-y-2">
        <Checkbox {...register("isPhoneVisible")} label="Show my phone number to other members in the directory" />
        <Checkbox {...register("celebrateBirthday")} label="Show my birthday on the feed on the day so classmates can send wishes (day and month only, never the year)" />
        <Checkbox {...register("celebrateAnniversary")} label="Show my membership anniversary on the feed" />
      </div>
    </div>
  );
}
