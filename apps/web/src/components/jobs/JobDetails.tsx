import { COMPANY_SIZE_LABELS, INDUSTRY_LABELS, applicationsClosed, applicationsLine, jobFacts, jobPlaceLabel, type JobDto, type JobFactKey } from "@illuminize/shared";
import clsx from "clsx";
import { useId, type ReactElement, type ReactNode } from "react";
import { EXTERNAL_REL, RichText } from "@/components/common/RichText";
import {
  IconClock,
  IconDirectory,
  IconEvents,
  IconExternalLink,
  IconGlobe,
  IconGraduationCap,
  IconJobs,
  IconLaptop,
  IconMapPin,
  IconStairs,
  IconTag,
  IconWallet,
  type IconProps,
} from "@/components/icons";
import { CompanyLogo } from "@/components/jobs/CompanyLogo";

const FACT_ICONS: Record<JobFactKey, (p: IconProps) => ReactElement> = {
  jobType: IconJobs,
  workMode: IconLaptop,
  location: IconMapPin,
  salary: IconWallet,
  salaryNote: IconTag,
  experience: IconClock,
  seniority: IconStairs,
  openings: IconDirectory,
  education: IconGraduationCap,
};

const SECTIONS = [
  { key: "description", title: "About the role" },
  { key: "responsibilities", title: "Responsibilities" },
  { key: "requirements", title: "Requirements" },
  { key: "benefits", title: "Benefits" },
  { key: "howToApply", title: "How to apply" },
] as const;

/**
 * On a job's own page the title is the h1 and each part an h2; in the admin's preview, under the Moderation page's h1, an
 * h2 and h3s, so no level is skipped.
 */
type Level = 1 | 2;
const headings = (level: Level) => (level === 1 ? (["h1", "h2"] as const) : (["h2", "h3"] as const));

/** A link's address without its scheme, as the company card shows it: what's written is where it goes. */
function shownAddress(href: string): string {
  try {
    const url = new URL(href);
    return `${url.host}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return href;
  }
}

function Section({ title, level, children }: { title: string; level: Level; children: ReactNode }) {
  const id = useId();
  const Heading = headings(level)[1];
  return (
    <section aria-labelledby={id} className="border-t border-slate-100 pt-4">
      <Heading id={id} className="text-base font-semibold text-slate-900">
        {title}
      </Heading>
      {children}
    </section>
  );
}

/**
 * Everything a job says about the role, in the order both apps show it: the header (logo, title, company and place), its
 * facts, its skills, then `apply`, then its sections. The title is the only heading that holds it, so the company's card
 * is headed "About the company" (`AboutCompany`, shown apart).
 *
 * Once applications have closed, the How to apply section goes with the apply area, unless `showClosedSections` (the
 * admin's preview, which shows whatever it's asked to approve).
 */
export function JobDetails({
  job,
  now,
  level = 1,
  titleId,
  badges,
  apply,
  showClosedSections = false,
}: {
  job: JobDto;
  now: number;
  level?: Level;
  /** Lets the page move focus to the title. */
  titleId?: string;
  badges?: ReactNode;
  apply?: ReactNode;
  showClosedSections?: boolean;
}) {
  const [Title] = headings(level);
  const place = jobPlaceLabel(job);
  const facts = jobFacts(job);
  const ended = applicationsClosed(job, now);
  // While open; once closed, the apply area says so in its place, so the line is on the page once.
  const closes = ended ? null : applicationsLine(job, now);
  const sections = SECTIONS.filter(({ key }) => (key !== "howToApply" || !ended || showClosedSections) && job[key]?.trim());
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-4">
        <CompanyLogo name={job.companyName} src={job.companyLogoUrl} />
        <div className="min-w-0 flex-1">
          <Title
            id={titleId}
            tabIndex={titleId ? -1 : undefined}
            className={clsx(
              "font-display font-semibold tracking-tight text-slate-900 outline-none [overflow-wrap:anywhere] focus-visible:ring-2 focus-visible:ring-primary/40",
              level === 1 ? "text-xl sm:text-2xl" : "text-base",
            )}
          >
            {job.title}
          </Title>
          <p className="mt-0.5 text-slate-600 [overflow-wrap:anywhere]">
            {job.companyName}
            {place ? ` · ${place}` : ""}
          </p>
          {badges && <div className="mt-2 flex flex-wrap items-center gap-2">{badges}</div>}
        </div>
      </div>
      {/* Each icon sits inside its term, so every row of the list is a term and its value and nothing else. */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-3">
        {facts.map(({ key, label, value }) => {
          const Icon = FACT_ICONS[key];
          return (
            <div key={key} className="relative min-w-0 pl-7">
              <dt className="text-xs text-slate-500">
                <Icon size={18} className="absolute left-0 top-0.5 text-slate-400" />
                {label}
              </dt>
              <dd className="text-sm font-medium text-slate-900 [overflow-wrap:anywhere]">{value}</dd>
            </div>
          );
        })}
        {closes && (
          <div className="relative col-span-full min-w-0 border-t border-slate-200 pl-7 pt-3">
            <dt className="sr-only">Applications</dt>
            <dd className="text-sm font-medium text-slate-900">
              <IconEvents size={18} className="absolute left-0 top-3 text-slate-400" />
              {closes}
            </dd>
          </div>
        )}
      </dl>
      {job.skills.length > 0 && (
        <ul aria-label="Skills" className="flex flex-wrap gap-1.5">
          {job.skills.map((skill) => (
            <li key={skill} className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary [overflow-wrap:anywhere]">
              {skill}
            </li>
          ))}
        </ul>
      )}
      {apply}
      {sections.map(({ key, title }) => (
        <Section key={key} title={title} level={level}>
          <RichText text={job[key]} className="mt-2" />
        </Section>
      ))}
    </div>
  );
}

/**
 * The company's card: its logo, name, industry and size, website and "about". Nothing when the job says no more about its
 * company than its name and logo, which the header already shows. `plain` shows the website as text, as the admin's
 * preview shows every address.
 */
export function AboutCompany({ job, level = 1, plain = false, className }: { job: JobDto; level?: Level; plain?: boolean; className?: string }) {
  const id = useId();
  const Heading = headings(level)[1];
  const about = job.aboutCompany?.trim() ? job.aboutCompany : null;
  if (!job.companyWebsite && !job.companyIndustry && !job.companySize && !about) return null;
  const meta = [job.companyIndustry && INDUSTRY_LABELS[job.companyIndustry], job.companySize && `${COMPANY_SIZE_LABELS[job.companySize]} employees`].filter(Boolean).join(" · ");
  return (
    <section aria-labelledby={id} className={className}>
      <Heading id={id} className="text-base font-semibold text-slate-900">
        About the company
      </Heading>
      <div className="mt-3 flex items-start gap-3">
        <CompanyLogo name={job.companyName} src={job.companyLogoUrl} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-slate-900 [overflow-wrap:anywhere]">{job.companyName}</p>
          {meta && <p className="text-sm text-slate-600">{meta}</p>}
          {job.companyWebsite &&
            (plain ? (
              <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-700 [overflow-wrap:anywhere]">
                <IconGlobe size={16} className="text-slate-400" />
                {job.companyWebsite}
              </p>
            ) : (
              <a href={job.companyWebsite} target="_blank" rel={EXTERNAL_REL} className="mt-1 inline-flex min-h-11 max-w-full items-center gap-1.5 text-sm font-medium text-primary hover:underline">
                <IconGlobe size={16} />
                <span className="min-w-0 [overflow-wrap:anywhere]">{shownAddress(job.companyWebsite)}</span>
                <IconExternalLink size={14} />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            ))}
        </div>
      </div>
      <RichText text={about} className="mt-3" />
    </section>
  );
}
