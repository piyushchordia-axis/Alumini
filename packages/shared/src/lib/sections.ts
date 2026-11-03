import type { TenantFeatures } from "../constants";
import { chatAvailable, mentorshipAvailable } from "./features";

type SectionRule = (features: TenantFeatures, chatEligible: boolean) => boolean;

/** The member app's sections in priority order. Each has a rule, not a feature key, because a section can depend on several keys. */
const SECTION_RULES = {
  feed: (f) => f.feed,
  // Group threads live in the inbox too, so either switch gives a member one.
  messages: (f, chatEligible) => chatAvailable(f, chatEligible),
  jobs: (f) => f.jobs,
  directory: (f) => f.directory,
  events: (f) => f.events,
  groups: (f, chatEligible) => f.groups && chatEligible,
  mentors: (f, chatEligible) => mentorshipAvailable(f, chatEligible),
  businesses: (f) => f.businesses,
  funding: (f) => f.funding,
} satisfies Record<string, SectionRule>;

export type MemberSection = keyof typeof SECTION_RULES;

export const MEMBER_SECTIONS = Object.keys(SECTION_RULES) as MemberSection[];

/** Phones show this many sections in the bar. More is always there too, because it also holds the profile and sign out. */
const BAR_SECTIONS = 4;

/**
 * `chatEligible` is the membership's own value. Pass false while it isn't known. `mentorsWayOut` keeps Mentors behind More
 * while its rule says no, for a member who still has a listing, a request or a mentorship there to leave: the ways out stay
 * open to them on the API, so the app mustn't hide the only way in.
 */
export function splitSections(features: TenantFeatures, chatEligible: boolean, opts: { mentorsWayOut?: boolean } = {}): { bar: MemberSection[]; overflow: MemberSection[] } {
  const enabled = MEMBER_SECTIONS.filter((s) => SECTION_RULES[s](features, chatEligible));
  const bar = enabled.slice(0, BAR_SECTIONS);
  const overflow = enabled.slice(BAR_SECTIONS);
  if (!opts.mentorsWayOut || enabled.includes("mentors")) return { bar, overflow };
  return { bar, overflow: MEMBER_SECTIONS.filter((s) => s === "mentors" || overflow.includes(s)) };
}

/**
 * The section a member lands on, or null when every other section is off and each app sends them to their profile. Never
 * Messages, which is why this asks as if they can't use chat: opening the app shouldn't put a private thread on screen.
 */
export function homeSection(features: TenantFeatures): MemberSection | null {
  return splitSections(features, false).bar[0] ?? null;
}
