import {
  INDUSTRY_LABELS,
  OPEN_TO_LABELS,
  PROFESSION_TYPE_LABELS,
  countryName,
  memberRoleLine,
  profileYearsLabel,
  yearsOfExperienceLabel,
  type MembershipDto,
  type OpenTo,
  type TenantType,
} from "@illuminize/shared";
import type { ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View, type ColorValue, type ViewStyle } from "react-native";
import { IconAt, IconCamera, IconCode, IconGlobe, IconGraduationCap, IconJobs, IconLink } from "@/components/icons";
import { RichText, linkProps } from "@/components/RichText";
import { Avatar, Badge, Row, headingRole } from "@/components/ui";
import { colors, radius, spacing, useTheme } from "@/theme";

/**
 * What a profile shows. The member's own MembershipDto and another member's MemberProfileDto both have these. Mentor and
 * Open to work come only with a member's profile and the directory's cards.
 */
export type ProfileView = Pick<
  MembershipDto,
  | "fullName"
  | "avatarUrl"
  | "batchYear"
  | "city"
  | "country"
  | "professionType"
  | "companyName"
  | "designation"
  | "headline"
  | "industry"
  | "careerStartYear"
  | "skills"
  | "degree"
  | "fieldOfStudy"
  | "experiences"
  | "education"
  | "linkedinUrl"
  | "websiteUrl"
  | "githubUrl"
  | "instagramUrl"
  | "xUrl"
  | "openTo"
  | "bio"
  | "interests"
> & { isMentor?: boolean; isOpenToWork?: boolean };

/** The line under a member's name: their headline, or else what they do and where, as cards say it. */
export const profileTagline = (p: Pick<ProfileView, "headline" | "designation" | "professionType" | "companyName">) => p.headline ?? memberRoleLine(p);

/** "Open to hiring", as a profile says it. */
export const openToLabel = (o: OpenTo) => `Open to ${OPEN_TO_LABELS[o].toLowerCase()}`;

type BadgeSource = Pick<ProfileView, "openTo" | "isMentor" | "isOpenToWork">;

/** The badges' words in full, for the name of a card, which a screen reader reads in place of what's on it. */
export const profileBadgeWords = (p: BadgeSource): string[] => [...(p.isOpenToWork ? ["Open to work"] : []), ...(p.isMentor ? ["Mentor"] : []), ...p.openTo.map(openToLabel)];

/**
 * Open to work, Mentor and what they're open to, for a wrapping row the caller lays out. What they offer others is one
 * colour, and looking for work another. A profile says "Open to hiring" in full; a card, short of room, shows "Hiring",
 * and its name (profileBadgeWords) says the rest.
 */
export function ProfileBadges({ profile, short }: { profile: BadgeSource; short?: boolean }) {
  return (
    <>
      {profile.isOpenToWork && <Badge label="Open to work" tone="success" />}
      {profile.isMentor && <Badge label="Mentor" tone="info" />}
      {profile.openTo.map((o) => (
        <Badge key={o} label={short ? OPEN_TO_LABELS[o] : openToLabel(o)} tone="info" />
      ))}
    </>
  );
}

/**
 * Photo, name, the headline under it, batch and place, then the badges, centred as on the web app's phone layout.
 * `nameExtras` sits beside the name (Admin), and `children` below everything.
 */
export function ProfileSummary({ profile, nameExtras, children }: { profile: ProfileView; nameExtras?: ReactNode; children?: ReactNode }) {
  const place = [profile.city, countryName(profile.country)].filter(Boolean).join(", ");
  const badges = !!profile.isOpenToWork || !!profile.isMentor || profile.openTo.length > 0;
  return (
    <View style={styles.summary}>
      <Avatar name={profile.fullName} src={profile.avatarUrl} size={88} />
      <Row style={{ justifyContent: "center", marginTop: spacing.xs }}>
        <Text {...headingRole(2)} style={styles.name}>
          {profile.fullName}
        </Text>
        {nameExtras}
      </Row>
      <Text style={styles.tagline}>{profileTagline(profile)}</Text>
      <Text style={styles.meta}>
        Batch of {profile.batchYear}
        {place ? ` · ${place}` : ""}
      </Text>
      {badges && (
        <Row gap={6} style={{ justifyContent: "center", marginTop: 2 }}>
          <ProfileBadges profile={profile} />
        </Row>
      )}
      {children}
    </View>
  );
}

type LinkKey = "linkedinUrl" | "websiteUrl" | "githubUrl" | "instagramUrl" | "xUrl";
type GlyphProps = { size?: number; color?: ColorValue };

/** Generic glyphs, not the sites' logos. A website is named by its host, so the link says where it goes. */
const LINKS: { key: LinkKey; label: (url: string) => string; Icon: (p: GlyphProps) => ReactNode }[] = [
  { key: "linkedinUrl", label: () => "LinkedIn", Icon: IconLink },
  { key: "websiteUrl", label: (url) => hostOf(url), Icon: IconGlobe },
  { key: "githubUrl", label: () => "GitHub", Icon: IconCode },
  { key: "instagramUrl", label: () => "Instagram", Icon: IconCamera },
  { key: "xUrl", label: () => "X", Icon: IconAt },
];

/** Members' own links: no referrer, no opener and no search-engine credit, as on the web app. */
const PROFILE_LINK_REL = "noopener noreferrer nofollow";

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Website";
  }
}

/**
 * A link as a 44-point pill. On the web export it's a real anchor the browser opens in a new tab; on a phone, a press opens
 * it in the browser, and the hint says where it goes.
 */
function LinkPill({ url, label, Icon }: { url: string; label: string; Icon: (p: GlyphProps) => ReactNode }) {
  const body = (
    <>
      <Icon size={16} color={colors.muted} />
      <Text style={styles.linkText} numberOfLines={1}>
        {label}
      </Text>
    </>
  );
  if (Platform.OS === "web")
    return (
      <View role="link" style={styles.linkPill} {...linkProps(url, PROFILE_LINK_REL)}>
        {body}
      </View>
    );
  return (
    <Pressable role="link" accessibilityLabel={label} accessibilityHint={url} style={({ pressed }) => [styles.linkPill, pressed ? { backgroundColor: colors.bg } : null]} {...linkProps(url, PROFILE_LINK_REL)}>
      {body}
    </Pressable>
  );
}

function SectionHeading({ icon, children }: { icon?: ReactNode; children: string }) {
  return (
    <View style={styles.headingRow}>
      {icon}
      <Text {...headingRole(3)} style={styles.heading}>
        {children}
      </Text>
    </View>
  );
}

interface TimelineItem {
  key: string;
  title: string;
  place: string | null;
  when: string;
  current?: boolean;
}

/** A vertical line with a dot per entry, newest at the top. The current role's dot is filled with the brand colour. */
function Timeline({ items }: { items: TimelineItem[] }) {
  const theme = useTheme();
  return (
    <View role="list" style={styles.timeline}>
      {items.map((item) => (
        <View key={item.key} role="listitem">
          <View aria-hidden style={[styles.dot, { backgroundColor: item.current ? theme.primary : colors.borderStrong }]} />
          <Text style={styles.itemTitle}>{item.title}</Text>
          {item.place ? <Text style={styles.itemPlace}>{item.place}</Text> : null}
          {item.when ? <Text style={styles.itemWhen}>{item.when}</Text> : null}
        </View>
      ))}
    </View>
  );
}

/**
 * Everything below a profile's summary: links, bio, skills, work and studies, interests. Empty parts are left out, so a
 * new member's profile is short rather than full of blanks, and nothing at all comes back when every part is empty.
 * Whatever the API sends is shown: it already leaves a current pupil's links and Open to out for anyone else. Degree
 * and field of study here are not shown at a school, which doesn't ask for them.
 */
export function ProfileDetails({ profile, tenant, style }: { profile: ProfileView; tenant: { name: string; type: TenantType }; style?: ViewStyle }) {
  const theme = useTheme();
  const links = LINKS.flatMap((l) => {
    const url = profile[l.key];
    return url ? [{ ...l, url }] : [];
  });
  // The form doesn't ask a student when they started working, so it isn't shown for one either.
  const experience = profile.professionType === "STUDENT" ? null : yearsOfExperienceLabel(profile.careerStartYear);
  const industry = profile.industry ? INDUSTRY_LABELS[profile.industry] : null;
  const facts = [experience, industry].filter(Boolean).join(" · ");

  const work: TimelineItem[] = [];
  if (profile.designation || profile.companyName)
    work.push({ key: "now", title: profile.designation ?? PROFESSION_TYPE_LABELS[profile.professionType], place: profile.companyName, when: "Now", current: true });
  profile.experiences.forEach((e, i) => work.push({ key: `past-${i}`, title: e.title, place: e.company, when: profileYearsLabel(e.startYear, e.endYear) }));

  const studies: TimelineItem[] = [];
  const here = tenant.type === "SCHOOL" ? "" : [profile.degree, profile.fieldOfStudy].filter(Boolean).join(", ");
  if (here) studies.push({ key: "here", title: tenant.name, place: here, when: `Batch of ${profile.batchYear}` });
  profile.education.forEach((e, i) =>
    studies.push({ key: `elsewhere-${i}`, title: e.institution, place: [e.degree, e.fieldOfStudy].filter(Boolean).join(", ") || null, when: profileYearsLabel(e.startYear, e.endYear) }),
  );

  const parts: ReactNode[] = [];
  if (links.length > 0)
    parts.push(
      <View key="links" role="list" aria-label="Links" style={styles.wrap}>
        {links.map(({ key, url, label, Icon }) => (
          <View key={key} role="listitem">
            <LinkPill url={url} label={label(url)} Icon={Icon} />
          </View>
        ))}
      </View>,
    );
  if (profile.bio)
    parts.push(
      <View key="bio">
        <SectionHeading>About</SectionHeading>
        <RichText text={profile.bio} style={styles.body} />
      </View>,
    );
  if (profile.skills.length > 0)
    parts.push(
      <View key="skills">
        <SectionHeading>Skills</SectionHeading>
        <View role="list" style={styles.wrap}>
          {profile.skills.map((s) => (
            <View key={s} role="listitem" style={[styles.skill, { backgroundColor: theme.primarySoft }]}>
              <Text style={{ fontSize: 14, color: theme.primary }}>{s}</Text>
            </View>
          ))}
        </View>
      </View>,
    );
  if (work.length > 0 || facts)
    parts.push(
      <View key="work">
        <SectionHeading icon={<IconJobs size={16} color={colors.muted} />}>Experience</SectionHeading>
        {facts ? <Text style={[styles.facts, work.length > 0 ? { marginBottom: spacing.md } : null]}>{facts}</Text> : null}
        {work.length > 0 && <Timeline items={work} />}
      </View>,
    );
  if (studies.length > 0)
    parts.push(
      <View key="studies">
        <SectionHeading icon={<IconGraduationCap size={16} color={colors.muted} />}>Education</SectionHeading>
        <Timeline items={studies} />
      </View>,
    );
  if (profile.interests.length > 0)
    parts.push(
      <View key="interests">
        <SectionHeading>Interests</SectionHeading>
        <View role="list" style={styles.wrap}>
          {profile.interests.map((i) => (
            <View key={i} role="listitem">
              <Badge label={i} />
            </View>
          ))}
        </View>
      </View>,
    );
  if (parts.length === 0) return null;
  return <View style={[{ gap: 20 }, style]}>{parts}</View>;
}

const styles = StyleSheet.create({
  summary: { alignItems: "center", gap: 4 },
  // Shrinks to wrap a long name within the row rather than run past it.
  name: { flexShrink: 1, fontSize: 22, fontWeight: "700", color: colors.text, textAlign: "center" },
  tagline: { fontSize: 15, color: "#334155", textAlign: "center" },
  meta: { fontSize: 13, color: colors.muted, textAlign: "center" },
  headingRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: spacing.sm },
  heading: { fontSize: 14, fontWeight: "700", color: colors.text },
  body: { fontSize: 15, lineHeight: 22, color: "#1e293b" },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  skill: { borderRadius: radius.full, paddingHorizontal: 12, paddingVertical: 5, maxWidth: "100%" },
  facts: { fontSize: 14, color: "#475569" },
  linkPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 44,
    maxWidth: "100%",
    paddingHorizontal: 14,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  linkText: { flexShrink: 1, fontSize: 14, fontWeight: "500", color: "#334155" },
  // The line runs down the left; each entry's dot is centred on it.
  timeline: { borderLeftWidth: 1, borderLeftColor: colors.border, marginLeft: 6, paddingLeft: 16, gap: 14 },
  dot: { position: "absolute", left: -22.5, top: 4, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: colors.card },
  itemTitle: { fontSize: 15, fontWeight: "600", color: colors.text },
  itemPlace: { fontSize: 14, color: "#475569" },
  itemWhen: { fontSize: 12, color: colors.muted },
});
