import type { MembershipStatus, TenantFeatures } from "../constants";
import { missingProfileItems, type ProfileStrength, type ProfileStrengthItem } from "./profile";
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

/**
 * Every word the walk-through says, the same on both apps. The first screen's title (welcomeTitle) and the second's line
 * (welcomeProfile) depend on the member, and the institution's own welcome message sits between the first screen's
 * title and its lead.
 */
export const WELCOME_COPY = {
  hello: {
    lead: "Here's a quick look around before you start.",
  },
  profile: {
    title: "Make your profile stand out",
    /** Photo or headline still missing: the two things people see first on every card. */
    start: "A photo and a headline help people recognise you and see what you do.",
    /** Both in, other things missing. */
    more: "Your photo and headline are in. A little more helps people find you.",
    /** Nothing missing. */
    complete: "Your profile has what people look for first.",
    /** Under the rows: following one leaves the walk-through, which counts as done. */
    linksHint: (count: number) => (count === 1 ? "It opens My profile and ends this welcome." : "Each opens My profile and ends this welcome."),
    later: "You can change it any time from My profile.",
  },
  explore: {
    title: "Find your people",
    body: (shortName: string) => `Here's what ${shortName} has for you. It's all in the menu too, any time.`,
  },
  skip: "Skip",
  back: "Back",
  next: "Next",
  done: "Get started",
} as const;

/** The first screen's title: "Welcome, Asha" from "Asha Rao", or just "Welcome" with no name to go by. */
export function welcomeTitle(fullName: string | null | undefined): string {
  const first = fullName?.trim().split(/\s+/)[0];
  return first ? `Welcome, ${first}` : "Welcome";
}

/** The line under each title: "1 of 3". `index` counts from 0, as welcomeSteps' list does. */
export function welcomeStepCount(index: number, count: number): string {
  return `${index + 1} of ${count}`;
}

/**
 * What the profile screen suggests (the WELCOME_PROFILE_ITEMS heaviest items missing, each a link into the part of My
 * profile it's added in) and the line above them, which says what's in when the photo and headline are.
 */
export function welcomeProfile(strength: ProfileStrength): { items: ProfileStrengthItem[]; body: string } {
  const missing = strength.items.filter((i) => !i.done);
  const items = missingProfileItems(strength, WELCOME_PROFILE_ITEMS);
  const body = missing.length === 0 ? WELCOME_COPY.profile.complete : missing.some((i) => i.key === "photo" || i.key === "headline") ? WELCOME_COPY.profile.start : WELCOME_COPY.profile.more;
  return { items, body };
}
