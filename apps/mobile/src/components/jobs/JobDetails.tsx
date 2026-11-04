import { COMPANY_SIZE_LABELS, INDUSTRY_LABELS, applicationsClosed, applicationsLine, jobFacts, jobPlaceLabel, type JobDto, type JobFactKey } from "@illuminize/shared";
import type { ReactElement, ReactNode } from "react";
import { Platform, Text, View } from "react-native";
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
import { ModerationNote } from "@/components/ModerationBadge";
import { linkProps, RichText } from "@/components/RichText";
import { Card } from "@/components/ui";
import { colors, radius, spacing, useTheme } from "@/theme";

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

/** A heading's level, which React Native's types don't know: on the web export, the job's title is the h1 and each part an h2. */
const level2 = { "aria-level": 2 } as object;
const sectionHeading = { fontSize: 16, fontWeight: "700", color: colors.text } as const;

/** A link's address without its scheme, as the company card shows it: what's written is where it goes. */
function shownAddress(href: string): string {
  try {
    const url = new URL(href);
    return `${url.host}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return href;
  }
}

/**
 * One fact: its icon, label and value. On a phone the three are one stop for a screen reader ("Salary: ₹25–40 LPA"); the
 * web export keeps them as text, where a label on a plain box isn't read.
 */
function Fact({ label, value, Icon }: { label: string; value: string; Icon: (p: IconProps) => ReactElement }) {
  const grouped = Platform.OS === "web" ? {} : { accessible: true, accessibilityLabel: `${label}: ${value}` };
  return (
    <View {...grouped} style={{ width: "50%", flexDirection: "row", gap: spacing.sm, paddingRight: spacing.sm }}>
      <View style={{ paddingTop: 1 }}>
        <Icon size={18} color={colors.faint} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 12, color: colors.muted }}>{label}</Text>
        <Text style={{ fontSize: 14, fontWeight: "600", color: colors.text }}>{value}</Text>
      </View>
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md }}>
      <Text role="heading" {...level2} style={sectionHeading}>
        {title}
      </Text>
      {children}
    </View>
  );
}

/**
 * Everything a job says about the role, in the order both apps show it: the header (logo, title, company and place), its
 * facts, its skills, then `apply`, then its sections. The title is the only heading that holds it, so the company's card
 * is headed "About the company" (`AboutCompany`, shown apart). Once applications have closed, the How to apply section goes
 * with the apply area.
 */
export function JobDetails({ job, now, badges, apply }: { job: JobDto; now: number; badges?: ReactNode; apply?: ReactNode }) {
  const theme = useTheme();
  const place = jobPlaceLabel(job);
  const facts = jobFacts(job);
  const ended = applicationsClosed(job, now);
  // While open; once closed, the apply area says so in its place, so the line is on the screen once.
  const closes = ended ? null : applicationsLine(job, now);
  const sections = SECTIONS.filter(({ key }) => (key !== "howToApply" || !ended) && job[key]?.trim());
  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.md }}>
        <CompanyLogo name={job.companyName} src={job.companyLogoUrl} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text role="heading" style={{ fontSize: 20, lineHeight: 26, fontWeight: "700", color: colors.text }}>
            {job.title}
          </Text>
          <Text style={{ fontSize: 14, color: "#475569" }}>
            {job.companyName}
            {place ? ` · ${place}` : ""}
          </Text>
          {badges ? <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: spacing.xs }}>{badges}</View> : null}
        </View>
      </View>
      <ModerationNote status={job.moderationStatus} note={job.moderationNote} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: spacing.md, borderRadius: radius.md, backgroundColor: "#f8fafc", padding: spacing.md }}>
        {facts.map(({ key, label, value }) => (
          <Fact key={key} label={label} value={value} Icon={FACT_ICONS[key]} />
        ))}
        {closes && (
          <View style={{ width: "100%", flexDirection: "row", alignItems: "center", gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md }}>
            <IconEvents size={18} color={colors.faint} />
            <Text style={{ flex: 1, fontSize: 14, fontWeight: "600", color: colors.text }}>{closes}</Text>
          </View>
        )}
      </View>
      {job.skills.length > 0 && (
        <View role="list" aria-label="Skills" style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {job.skills.map((skill) => (
            <View key={skill} role="listitem" style={{ maxWidth: "100%", borderRadius: radius.full, backgroundColor: theme.primarySoft, paddingHorizontal: 10, paddingVertical: 4 }}>
              <Text style={{ fontSize: 12, fontWeight: "600", color: theme.primary }}>{skill}</Text>
            </View>
          ))}
        </View>
      )}
      {apply}
      {sections.map(({ key, title }) => (
        <Section key={key} title={title}>
          <RichText text={job[key]} />
        </Section>
      ))}
    </View>
  );
}

/**
 * The company's card: its logo, name, industry and size, website and "about". Nothing when the job says no more about its
 * company than its name and logo, which the header already shows.
 */
export function AboutCompany({ job }: { job: JobDto }) {
  const theme = useTheme();
  const about = job.aboutCompany?.trim() ? job.aboutCompany : null;
  if (!job.companyWebsite && !job.companyIndustry && !job.companySize && !about) return null;
  const meta = [job.companyIndustry && INDUSTRY_LABELS[job.companyIndustry], job.companySize && `${COMPANY_SIZE_LABELS[job.companySize]} employees`].filter(Boolean).join(" · ");
  return (
    <Card>
      <Text role="heading" {...level2} style={sectionHeading}>
        About the company
      </Text>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.md }}>
        <CompanyLogo name={job.companyName} src={job.companyLogoUrl} size="sm" />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 15, fontWeight: "600", color: colors.text }}>{job.companyName}</Text>
          {!!meta && <Text style={{ fontSize: 13, color: "#475569" }}>{meta}</Text>}
          {job.companyWebsite && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <IconGlobe size={16} color={theme.primary} />
              {/* Padded to a 44-point target; the text is the address, so where it goes is what it says. */}
              <Text role="link" {...linkProps(job.companyWebsite)} style={{ flexShrink: 1, paddingVertical: 12, fontSize: 14, fontWeight: "600", color: theme.primary }}>
                {shownAddress(job.companyWebsite)}
              </Text>
              <IconExternalLink size={14} color={theme.primary} />
            </View>
          )}
        </View>
      </View>
      <RichText text={about} />
    </Card>
  );
}
