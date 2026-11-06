import { COMPANY_SIZE_LABELS, INDUSTRY_LABELS, applicationsClosed, applicationsLine, jobFacts, jobPlaceLabel, jobSectionsShown, shownAddress, type JobDto, type JobFactKey } from "@illuminize/shared";
import type { ReactElement, ReactNode } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
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
import { JobSkills, type SkillsViewer } from "@/components/jobs/JobSkills";
import { linkProps, RichText } from "@/components/RichText";
import { Card, headingRole } from "@/components/ui";
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

/**
 * On a job's own page the title is the h1 and each part an h2 (on the web export; phones have one heading role and no
 * levels). In the admin's preview, under the Moderation screen's title, an h2 and h3s, so no level is skipped.
 */
type Level = 1 | 2;
const partHeading = (level: Level) => headingRole(level === 1 ? 2 : 3);
const sectionHeading = { fontSize: 16, fontWeight: "700", color: colors.text } as const;

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

function Section({ title, level, children }: { title: string; level: Level; children: ReactNode }) {
  return (
    <View style={{ gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md }}>
      <Text {...partHeading(level)} style={sectionHeading}>
        {title}
      </Text>
      {children}
    </View>
  );
}

/**
 * Everything a job says about the role, in the order both apps show it: the header (logo, title, company and place), its
 * facts, its skills, then `apply`, then its sections. The title is the only heading that holds it, so the company's card
 * is headed "About the company" (`AboutCompany`, shown apart). `notice` goes under the header, such as the admin's note on
 * the poster's own rejected job. Once applications have closed, the How to apply section goes with the apply area, unless
 * `showClosedSections` (the admin's preview, which shows whatever it's asked to approve). `viewer` is who's reading, to
 * mark the skills they have; left out for the job's poster and in the admin's preview, which mark none.
 */
export function JobDetails({
  job,
  now,
  level = 1,
  badges,
  notice,
  apply,
  showClosedSections = false,
  viewer,
}: {
  job: JobDto;
  now: number;
  level?: Level;
  badges?: ReactNode;
  notice?: ReactNode;
  apply?: ReactNode;
  showClosedSections?: boolean;
  viewer?: SkillsViewer;
}) {
  const place = jobPlaceLabel(job);
  const facts = jobFacts(job);
  const ended = applicationsClosed(job, now);
  // While open; once closed, the apply area says so in its place, so the line is on the screen once.
  const closes = ended ? null : applicationsLine(job, now);
  const sections = jobSectionsShown(job, now, showClosedSections);
  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.md }}>
        <CompanyLogo name={job.companyName} src={job.companyLogoUrl} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text {...(level === 1 ? { role: "heading" as const } : headingRole(2))} style={[styles.title, level === 2 ? styles.titleSmall : null]}>
            {job.title}
          </Text>
          <Text style={{ fontSize: 14, color: "#475569" }}>
            {job.companyName}
            {place ? ` · ${place}` : ""}
          </Text>
          {badges ? <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: spacing.xs }}>{badges}</View> : null}
        </View>
      </View>
      {notice}
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
      {job.skills.length > 0 && <JobSkills skills={job.skills} viewer={viewer} />}
      {apply}
      {sections.map(({ key, title }) => (
        <Section key={key} title={title} level={level}>
          <RichText text={job[key]} />
        </Section>
      ))}
    </View>
  );
}

/**
 * The company's card: its logo, name, industry and size, website and "about". Nothing when the job says no more about its
 * company than its name and logo, which the header already shows. `plain` shows the website as text, as the admin's
 * preview shows every address, and `framed={false}` draws it under a rule rather than as a card of its own, inside the
 * preview's panel.
 */
export function AboutCompany({ job, level = 1, plain = false, framed = true }: { job: JobDto; level?: Level; plain?: boolean; framed?: boolean }) {
  const theme = useTheme();
  const about = job.aboutCompany?.trim() ? job.aboutCompany : null;
  if (!job.companyWebsite && !job.companyIndustry && !job.companySize && !about) return null;
  const meta = [job.companyIndustry && INDUSTRY_LABELS[job.companyIndustry], job.companySize && `${COMPANY_SIZE_LABELS[job.companySize]} employees`].filter(Boolean).join(" · ");
  const body = (
    <>
      <Text {...partHeading(level)} style={sectionHeading}>
        About the company
      </Text>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.md }}>
        <CompanyLogo name={job.companyName} src={job.companyLogoUrl} size="sm" />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 15, fontWeight: "600", color: colors.text }}>{job.companyName}</Text>
          {!!meta && <Text style={{ fontSize: 13, color: "#475569" }}>{meta}</Text>}
          {job.companyWebsite && plain && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
              <IconGlobe size={16} color={colors.faint} />
              <Text selectable style={{ flexShrink: 1, fontSize: 14, color: "#334155" }}>
                {job.companyWebsite}
              </Text>
            </View>
          )}
          {job.companyWebsite && !plain && (
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
    </>
  );
  return framed ? <Card>{body}</Card> : <View style={styles.unframed}>{body}</View>;
}

const styles = StyleSheet.create({
  title: { fontSize: 20, lineHeight: 26, fontWeight: "700", color: colors.text },
  titleSmall: { fontSize: 16, lineHeight: 22 },
  unframed: { gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md },
});
