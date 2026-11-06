import { ADMIN_SECTIONS, type AdminSectionKey, type MembershipDto, type MembershipSummaryDto, type UserDto } from "@illuminize/shared";
import { isApiClientError } from "@illuminize/shared/client";
import { qk } from "./queryKeys";

/** The admin console's home, which is its Dashboard: a stack above the tabs. */
export function adminHomeHref(slug: string): `/t/${string}` {
  return `/t/${slug}/admin`;
}

/**
 * A section of the console, opened with `query`. The routes are the web console's, below `/t/{slug}/admin`, but for the
 * Dashboard, which is the console's home.
 */
export function adminSectionHref(slug: string, key: AdminSectionKey, query?: Readonly<Record<string, string>>): `/t/${string}` {
  const section = ADMIN_SECTIONS.find((s) => s.key === key);
  const path: `/t/${string}` = !section || key === "dashboard" ? adminHomeHref(slug) : `/t/${slug}/admin/${section.path}`;
  // By hand: React Native's URLSearchParams is incomplete.
  const search = Object.entries(query ?? {})
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
    .join("&");
  return search ? `${path}?${search}` : path;
}

/** A member's page in the console, as on the web console. */
export function adminMemberHref(slug: string, membershipId: string): `/t/${string}` {
  return `/t/${slug}/admin/members/${membershipId}`;
}

/**
 * Whether the stored session makes this person an admin of `slug`, by the (app) layout's rule: the institution's admin,
 * or Illuminize staff. For a push that opens the app cold, before the membership has loaded; the console's guard still
 * decides once it has.
 */
export function isStoredAdminOf(session: StoredAdminSession, slug: string): boolean {
  return !!session.user?.isPlatformAdmin || session.memberships.some((m) => m.tenant.slug === slug && m.role === "TENANT_ADMIN");
}

/** The parts of the stored session that say who is an admin where. */
export interface StoredAdminSession {
  user: Pick<UserDto, "isPlatformAdmin"> | null;
  memberships: readonly { role: MembershipSummaryDto["role"]; tenant: Pick<MembershipSummaryDto["tenant"], "slug"> }[];
}

/**
 * Whether a tapped admin push opens the console: by the membership the app has loaded, when it has one, as the console's
 * guard reads it (the (app) layout's rule), so the two agree; on a cold start, before it has loaded, by the stored session.
 */
export function isPushAdminOf(session: StoredAdminSession, membership: Pick<MembershipDto, "role" | "status"> | undefined, slug: string): boolean {
  if (!membership) return isStoredAdminOf(session, slug);
  return membership.status === "APPROVED" && (membership.role === "TENANT_ADMIN" || !!session.user?.isPlatformAdmin);
}

/**
 * Whether a tapped admin push should be opened over what is on screen (`router.navigate`) rather than stacked on it
 * (`router.push`): when the push's institution, or none yet, is on screen. Navigate reuses a console home that is already
 * in front instead of stacking a copy of it, and on a cold start it reuses the institution the start screen has just
 * redirected to instead of adding a second one. Another institution on screen keeps its stack, with the push's above it.
 */
export function opensInPlace(pathname: string, slug: string): boolean {
  const shown = /^\/t\/([^/?#]+)/.exec(pathname)?.[1];
  return shown === undefined || shown === slug;
}

/**
 * The membership to fetch again after a query fails, or null. An admin query refused (403) may mean the member is no
 * longer an admin there, so their membership is fetched again, and the console's guard and the More row follow it. Any
 * 403 does: telling a lost role from another refusal would take a new error code, and the extra request is cheap.
 * Admin keys carry the institution second (adminKeys).
 */
export function membershipToRefetch(error: unknown, queryKey: readonly unknown[]): ReturnType<typeof qk.membership> | null {
  const [scope, slug] = queryKey;
  return scope === "admin" && typeof slug === "string" && isApiClientError(error) && error.status === 403 ? qk.membership(slug) : null;
}
