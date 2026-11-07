import { homeSection, welcomeDue, type MemberSection, type MembershipStatus, type TenantFeatures } from "@illuminize/shared";

// Where a member lands. Nothing here imports the app, so the API's unit tests can load it (lib/sections re-exports it).

/** Each section's route folder under (app)/(tabs), which is also its URL segment. */
export const SECTION_PATHS: Record<MemberSection, string> = {
  feed: "feed",
  messages: "messages",
  jobs: "jobs",
  directory: "directory",
  events: "events",
  groups: "groups",
  mentors: "mentors",
  businesses: "businesses",
  funding: "funding",
};

/** Where a member lands: the home section, or their profile when every section is off. */
export function homeHref(slug: string, features: TenantFeatures): `/t/${string}` {
  const home = homeSection(features);
  return `/t/${slug}/${home ? SECTION_PATHS[home] : "profile"}`;
}

/** The first-entry walk-through: a screen of the (app) stack above the tabs, like the admin console. */
export function welcomeHref(slug: string): `/t/${string}` {
  return `/t/${slug}/welcome`;
}

/**
 * Where the front door (the landing screen, signing in, registering, the waiting screen once approved) takes an approved
 * member: the walk-through while they're owed it (welcomeDue), otherwise their home section. Nothing else opens the
 * walk-through: a link or a push opens its own screen, and the walk-through waits for the next time they come in here.
 */
export function entryHref(slug: string, features: TenantFeatures, membership: { status: MembershipStatus; welcomeDoneAt?: string | null }): `/t/${string}` {
  return welcomeDue(membership) ? welcomeHref(slug) : homeHref(slug, features);
}

/** Whether `pathname` (usePathname's, without the query) is this institution's walk-through. */
export function isWelcomePath(pathname: string, slug: string): boolean {
  return pathname.replace(/\/+$/, "") === welcomeHref(slug);
}
