import type { MembershipStatus, TenantFeatures } from "../constants";
import { splitSections, type MemberSection } from "./sections";

/**
 * Whether a member is owed the first-entry walk-through: approved, and they haven't finished or skipped it here. Only the
 * member's own membership carries `welcomeDoneAt`, so anything without the key (another view of them, an answer cached
 * before the key came in) counts as not owed: the walk-through never opens on a guess.
 */
export function welcomeDue(m: { status: MembershipStatus; welcomeDoneAt?: string | null }): boolean {
  return m.status === "APPROVED" && m.welcomeDoneAt === null;
}

/**
 * The order its last screen lists the sections in: people first, then what's on. Never the feed, where Get started
 * lands them anyway (or their home section, when the feed is off).
 */
export const WELCOME_SECTION_ORDER: readonly Exclude<MemberSection, "feed">[] = ["directory", "mentors", "groups", "messages", "events", "jobs", "businesses", "funding"];

/**
 * The sections the walk-through's last screen lists: every one this member can open, in the bar or behind More, in
 * WELCOME_SECTION_ORDER. `features` is the resolved map and `chatEligible` the membership's own value. Empty when only
 * the feed (or nothing) is on, and then the screen is left out (welcomeSteps).
 */
export function welcomeSections(features: TenantFeatures, chatEligible: boolean): MemberSection[] {
  const { bar, overflow } = splitSections(features, chatEligible);
  const open = new Set<MemberSection>([...bar, ...overflow]);
  return WELCOME_SECTION_ORDER.filter((s) => open.has(s));
}

/** The walk-through's screens: hello (the welcome message), profile (what to add first) and explore (the sections). */
export type WelcomeStep = "hello" | "profile" | "explore";

/** Its screens, in order: explore is left out when there's no section to list, so the counter reads "of 2". */
export function welcomeSteps(sections: readonly MemberSection[]): WelcomeStep[] {
  return sections.length > 0 ? ["hello", "profile", "explore"] : ["hello", "profile"];
}

/** How many missing profile items its profile screen suggests (missingProfileItems), the heaviest first. */
export const WELCOME_PROFILE_ITEMS = 2;
