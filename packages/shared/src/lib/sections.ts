import type { TenantFeatures } from "../constants";

type SectionRule = (features: TenantFeatures) => boolean;

/** The member app's sections in priority order. Each has a rule, not a feature key, because a section can depend on several keys. */
const SECTION_RULES = {
  feed: (f) => f.feed,
  jobs: (f) => f.jobs,
  directory: (f) => f.directory,
  events: (f) => f.events,
  businesses: (f) => f.businesses,
  funding: (f) => f.funding,
} satisfies Record<string, SectionRule>;

export type MemberSection = keyof typeof SECTION_RULES;

export const MEMBER_SECTIONS = Object.keys(SECTION_RULES) as MemberSection[];

/** Phones show this many sections in the bar. More is always there too, because it also holds the profile and sign out. */
const BAR_SECTIONS = 4;

export function splitSections(features: TenantFeatures): { bar: MemberSection[]; overflow: MemberSection[] } {
  const enabled = MEMBER_SECTIONS.filter((s) => SECTION_RULES[s](features));
  return { bar: enabled.slice(0, BAR_SECTIONS), overflow: enabled.slice(BAR_SECTIONS) };
}

/** The section a member lands on, or null when every section is off and each app sends them to their profile. */
export function homeSection(features: TenantFeatures): MemberSection | null {
  return splitSections(features).bar[0] ?? null;
}
