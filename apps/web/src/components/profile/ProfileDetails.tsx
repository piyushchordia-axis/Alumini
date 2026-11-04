import {
  INDUSTRY_LABELS,
  OPEN_TO_LABELS,
  PROFESSION_TYPE_LABELS,
  countryName,
  memberRoleLine,
  profileYearsLabel,
  yearsOfExperienceLabel,
  type MembershipDto,
  type TenantType,
} from "@illuminize/shared";
import clsx from "clsx";
import type { ReactNode } from "react";
import { RichText } from "@/components/common/RichText";
import { IconAt, IconCamera, IconCode, IconGlobe, IconGraduationCap, IconJobs, IconLink, type IconProps } from "@/components/icons";
import { Avatar, Badge } from "@/components/ui";

/**
 * What a profile shows. The member's own MembershipDto, another member's MemberProfilePage DTO and an admin's view all
 * have these. Mentor and Open to work come only with a member's profile and the directory's cards.
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

/**
 * Mentor, Open to work and what they're open to, as badges for a flex row the caller lays out. What they offer others is
 * one colour, and looking for work another. A profile says "Open to hiring" in full; a card, short of room, shows
 * "Hiring", and says "Open to" to screen readers only.
 */
export function ProfileBadges({ profile, short }: { profile: Pick<ProfileView, "openTo" | "isMentor" | "isOpenToWork">; short?: boolean }) {
  return (
    <>
      {profile.isOpenToWork && <Badge tone="success">Open to work</Badge>}
      {profile.isMentor && <Badge tone="info">Mentor</Badge>}
      {profile.openTo.map((o) =>
        short ? (
          <Badge key={o} tone="info">
            <span className="sr-only">Open to </span>
            {OPEN_TO_LABELS[o]}
          </Badge>
        ) : (
          <Badge key={o} tone="info">{`Open to ${OPEN_TO_LABELS[o].toLowerCase()}`}</Badge>
        ),
      )}
    </>
  );
}

/**
 * Photo, name, the headline under it, batch and place, then the badges. `nameExtras` sits beside the name (Admin, a
 * status), and `children` below everything (actions). Centred on a phone, beside the photo from `sm` up.
 */
export function ProfileSummary({
  profile,
  nameAs: Name = "h1",
  nameExtras,
  children,
}: {
  profile: ProfileView;
  nameAs?: "h1" | "h2";
  nameExtras?: ReactNode;
  children?: ReactNode;
}) {
  const place = [profile.city, countryName(profile.country)].filter(Boolean).join(", ");
  const badges = !!profile.isOpenToWork || !!profile.isMentor || profile.openTo.length > 0;
  return (
    <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:items-start sm:text-left">
      <Avatar name={profile.fullName} src={profile.avatarUrl} size="xl" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
          <Name className={clsx("font-semibold text-slate-900 [overflow-wrap:anywhere]", Name === "h1" ? "text-2xl" : "text-xl")}>{profile.fullName}</Name>
          {nameExtras}
        </div>
        <p className="mt-0.5 text-slate-700 [overflow-wrap:anywhere]">{profileTagline(profile)}</p>
        <p className="text-sm text-slate-500">
          Batch of {profile.batchYear}
          {place ? ` · ${place}` : ""}
        </p>
        {badges && (
          <div className="mt-2 flex flex-wrap justify-center gap-1.5 sm:justify-start">
            <ProfileBadges profile={profile} />
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

type LinkKey = "linkedinUrl" | "websiteUrl" | "githubUrl" | "instagramUrl" | "xUrl";

/** Generic glyphs, not the sites' logos. A website is named by its host, so the link says where it goes. */
const LINKS: Array<{ key: LinkKey; label: (url: string) => string; Icon: (p: IconProps) => ReactNode }> = [
  { key: "linkedinUrl", label: () => "LinkedIn", Icon: IconLink },
  { key: "websiteUrl", label: (url) => hostOf(url), Icon: IconGlobe },
  { key: "githubUrl", label: () => "GitHub", Icon: IconCode },
  { key: "instagramUrl", label: () => "Instagram", Icon: IconCamera },
  { key: "xUrl", label: () => "X", Icon: IconAt },
];

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Website";
  }
}

function SectionHeading({ level, icon, children }: { level: 2 | 3; icon?: ReactNode; children: ReactNode }) {
  const H = level === 2 ? "h2" : "h3";
  return (
    <H className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900">
      {icon && <span className="text-slate-500">{icon}</span>}
      {children}
    </H>
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
  return (
    <ol className="space-y-4 border-s border-slate-200 ps-5">
      {items.map((item) => (
        <li key={item.key} className="relative">
          <span aria-hidden className={clsx("absolute -start-[25.5px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-[var(--surface-1)]", item.current ? "bg-primary" : "bg-slate-300")} />
          <p className="font-medium text-slate-900 [overflow-wrap:anywhere]">{item.title}</p>
          {item.place && <p className="text-sm text-slate-600 [overflow-wrap:anywhere]">{item.place}</p>}
          {item.when && <p className="text-xs text-slate-500">{item.when}</p>}
        </li>
      ))}
    </ol>
  );
}

/**
 * Everything below a profile's summary: links, bio, skills, work and studies, interests. Empty parts are left out, so a
 * new member's profile is short rather than full of blanks. Whatever the API sends is shown: it already leaves a current
 * pupil's links and Open to out for anyone else. Degree and field of study here are not shown at a school, which doesn't
 * ask for them.
 */
export function ProfileDetails({
  profile,
  tenant,
  headingLevel = 2,
  className,
}: {
  profile: ProfileView;
  tenant: { name: string; type: TenantType };
  headingLevel?: 2 | 3;
  className?: string;
}) {
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

  const parts = [
    links.length > 0 && (
      <ul key="links" className="flex flex-wrap gap-2" aria-label="Links">
        {links.map(({ key, url, label, Icon }) => (
          <li key={key}>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              title={url}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <Icon size={16} className="text-slate-500" />
              <span className="[overflow-wrap:anywhere]">{label(url)}</span>
            </a>
          </li>
        ))}
      </ul>
    ),
    profile.bio && (
      <section key="bio">
        <SectionHeading level={headingLevel}>About</SectionHeading>
        <RichText text={profile.bio} />
      </section>
    ),
    profile.skills.length > 0 && (
      <section key="skills">
        <SectionHeading level={headingLevel}>Skills</SectionHeading>
        <ul className="flex flex-wrap gap-1.5">
          {profile.skills.map((s) => (
            <li key={s} className="rounded-full bg-primary/10 px-3 py-1 text-sm text-primary [overflow-wrap:anywhere]">
              {s}
            </li>
          ))}
        </ul>
      </section>
    ),
    (work.length > 0 || facts) && (
      <section key="work">
        <SectionHeading level={headingLevel} icon={<IconJobs size={16} />}>
          Experience
        </SectionHeading>
        {facts && <p className={clsx("text-sm text-slate-600", work.length > 0 && "mb-3")}>{facts}</p>}
        {work.length > 0 && <Timeline items={work} />}
      </section>
    ),
    studies.length > 0 && (
      <section key="studies">
        <SectionHeading level={headingLevel} icon={<IconGraduationCap size={16} />}>
          Education
        </SectionHeading>
        <Timeline items={studies} />
      </section>
    ),
    profile.interests.length > 0 && (
      <section key="interests">
        <SectionHeading level={headingLevel}>Interests</SectionHeading>
        <ul className="flex flex-wrap gap-1.5">
          {profile.interests.map((i) => (
            <li key={i}>
              <Badge>{i}</Badge>
            </li>
          ))}
        </ul>
      </section>
    ),
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return <div className={clsx("space-y-5", className)}>{parts}</div>;
}
