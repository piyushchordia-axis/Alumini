import type { TenantFeatures } from "../constants";
import { chatAvailable } from "./features";

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
  businesses: (f) => f.businesses,
  funding: (f) => f.funding,
} satisfies Record<string, SectionRule>;

export type MemberSection = keyof typeof SECTION_RULES;

export const MEMBER_SECTIONS = Object.keys(SECTION_RULES) as MemberSection[];

/** Phones show this many sections in the bar. More is always there too, because it also holds the profile and sign out. */
const BAR_SECTIONS = 4;

/** `chatEligible` is the membership's own value. Pass false while it isn't known. */
export function splitSections(features: TenantFeatures, chatEligible: boolean): { bar: MemberSection[]; overflow: MemberSection[] } {
  const enabled = MEMBER_SECTIONS.filter((s) => SECTION_RULES[s](features, chatEligible));
  return { bar: enabled.slice(0, BAR_SECTIONS), overflow: enabled.slice(BAR_SECTIONS) };
}

/**
 * The section a member lands on, or null when every other section is off and each app sends them to their profile. Never
 * Messages, which is why this asks as if they can't use chat: opening the app shouldn't put a private thread on screen.
 */
export function homeSection(features: TenantFeatures): MemberSection | null {
  return splitSections(features, false).bar[0] ?? null;
}
