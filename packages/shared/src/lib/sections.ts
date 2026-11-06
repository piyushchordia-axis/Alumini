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

/** Each section's name, the same on the web's sidebar, bar and More sheet and on the phone's tabs and More. */
export const SECTION_LABELS: Readonly<Record<MemberSection, string>> = {
  feed: "Feed",
  messages: "Messages",
  jobs: "Jobs",
  directory: "Directory",
  events: "Events",
  groups: "Groups",
  mentors: "Mentors",
  businesses: "Businesses",
  funding: "Funding",
};

/**
 * One line on what each section holds, under its name in More and on the walk-through's list. No line holds another
 * section's name or another way through the app (sections.test.ts checks): members and e2e alike find a link by its
 * text, and a line that said "Groups" would be a second match for it.
 */
export const SECTION_DESCRIPTIONS: Readonly<Record<MemberSection, string>> = {
  feed: "Posts and news from members",
  messages: "Your conversations",
  jobs: "Openings and referrals",
  directory: "Find people by name or year",
  events: "Meetups and get-togethers",
  groups: "Shared conversations",
  mentors: "Find a mentor, or become one",
  businesses: "Companies run by members",
  funding: "Members raising and investing",
};

/** Mentors' line for a member it stays open to only as a way out (splitSections' `mentorsWayOut`): there's no one to find there now. */
export const MENTORS_WAY_OUT_DESCRIPTION = "Your requests and mentorships";

/** A section's line, as `splitSections` was asked for it: pass the same `mentorsWayOut`. */
export function sectionDescription(section: MemberSection, opts: { mentorsWayOut?: boolean } = {}): string {
  return section === "mentors" && opts.mentorsWayOut ? MENTORS_WAY_OUT_DESCRIPTION : SECTION_DESCRIPTIONS[section];
}

/** More's groups of sections, before its own rows (You) and the account's. */
export type HubGroupKey = "connect" | "community";

/** Every section has a group, so one that ever overflows (Messages or Directory, Feed or Jobs) still finds its place. */
const HUB_GROUP_OF: Readonly<Record<MemberSection, HubGroupKey>> = {
  feed: "community",
  messages: "connect",
  jobs: "community",
  directory: "connect",
  events: "community",
  groups: "connect",
  mentors: "connect",
  businesses: "community",
  funding: "community",
};

export const HUB_GROUP_TITLES: Readonly<Record<HubGroupKey, string>> = { connect: "Connect", community: "Community" };

const HUB_GROUP_ORDER: readonly HubGroupKey[] = ["connect", "community"];

export interface MoreHubGroup {
  key: HubGroupKey;
  title: string;
  sections: MemberSection[];
}

/**
 * The sections behind More (`overflow` from splitSections, so feature switches, current pupils and the mentors way out
 * are already applied), grouped: Connect, then Community, each in priority order. A group with nothing in it is left out.
 */
export function moreHubGroups(sections: readonly MemberSection[]): MoreHubGroup[] {
  return HUB_GROUP_ORDER.map((key) => ({ key, title: HUB_GROUP_TITLES[key], sections: MEMBER_SECTIONS.filter((s) => HUB_GROUP_OF[s] === key && sections.includes(s)) })).filter((g) => g.sections.length > 0);
}

/** The heading over More's own rows: My posts, My profile and, for an admin, Admin console. Switch institution and Sign out come after it, untitled. */
export const MORE_HUB_YOU_TITLE = "You";

/** More's own rows, each with its line, which follows the rule SECTION_DESCRIPTIONS does. Admin console's name gains its count (adminConsoleLabel). */
export const MORE_HUB_ROWS = {
  myPosts: { label: "My posts", description: "Everything you've shared" },
  myProfile: { label: "My profile", description: "Your details and settings" },
  adminConsole: { label: "Admin console", description: "Members, moderation and settings" },
} as const satisfies Record<string, { label: string; description: string }>;

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
