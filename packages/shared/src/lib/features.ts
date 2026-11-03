import { TENANT_FEATURES, type ChatGroupVisibility, type TenantFeature, type TenantFeatures, type TenantType } from "../constants";
import { wallPartsInZone } from "./time";

/** Keys that start off for schools and that retyping an institution to SCHOOL forces off. Its admin can turn them on. */
export const SCHOOL_OFF_FEATURES: readonly TenantFeature[] = ["messaging", "groups", "mentorship"];

/**
 * The kinds of group these switches allow. Open groups need `groups`. An invite-only group of two is a private chat, so it
 * needs `messaging` as well. Switching either off hides what it no longer allows and deletes nothing.
 */
export function enabledGroupVisibilities(features: TenantFeatures): ChatGroupVisibility[] {
  if (!features.groups) return [];
  return features.messaging ? ["OPEN", "INVITE_ONLY"] : ["OPEN"];
}

/** Whether this member has a Messages inbox here: direct chats or groups are on, and they aren't a current pupil. */
export function chatAvailable(features: TenantFeatures, chatEligible: boolean): boolean {
  return (features.messaging || features.groups) && chatEligible;
}

/**
 * Whether this member can use mentorship here: it's switched on, with messaging, because accepting opens a private chat, and
 * they aren't a current pupil. A resolved map never has one without the other, but a hand-built one might.
 */
export function mentorshipAvailable(features: TenantFeatures, chatEligible: boolean): boolean {
  return features.mentorship && features.messaging && chatEligible;
}

/**
 * Whether referral requests are on here. They live inside Jobs and have no key of their own: accepting one opens a private
 * chat, so they need messaging as well, which is why a school starts with them off.
 */
export function referralsEnabled(features: TenantFeatures): boolean {
  return features.jobs && features.messaging;
}

/** Whether this member can ask for referrals and offer them here: referrals are on, and they aren't a current pupil. */
export function referralsAvailable(features: TenantFeatures, chatEligible: boolean): boolean {
  return referralsEnabled(features) && chatEligible;
}

/** Whether this member has anything that connects them one to one beyond messages, which is what CONNECTIONS notifications are about. */
export function connectionsAvailable(features: TenantFeatures, chatEligible: boolean): boolean {
  return mentorshipAvailable(features, chatEligible) || referralsAvailable(features, chatEligible);
}

/** What each key needs: a key reads as off while what it needs is off. One level deep, so a prerequisite has none of its own. */
export const FEATURE_PREREQUISITES: Readonly<Partial<Record<TenantFeature, TenantFeature>>> = { mentorship: "messaging" };

export function defaultFeaturesFor(type: TenantType): TenantFeatures {
  const off = type === "SCHOOL" ? SCHOOL_OFF_FEATURES : [];
  return Object.fromEntries(TENANT_FEATURES.map((f) => [f, !off.includes(f)])) as TenantFeatures;
}

/** The complete map to act on: stored keys win, missing keys take the type's default, then prerequisites apply. */
export function resolveFeatures(type: TenantType, stored: Partial<TenantFeatures> | null | undefined): TenantFeatures {
  const defaults = defaultFeaturesFor(type);
  const resolved = Object.fromEntries(TENANT_FEATURES.map((f) => [f, stored?.[f] ?? defaults[f]])) as TenantFeatures;
  for (const f of TENANT_FEATURES) {
    const needs = FEATURE_PREREQUISITES[f];
    if (needs && !resolved[needs]) resolved[f] = false;
  }
  return resolved;
}

export interface FeatureChangeResult {
  /** The complete map to store. */
  features: TenantFeatures;
  /** A key the change may not turn on. When set, the caller refuses the change and stores nothing. */
  conflict: TenantFeature | null;
}

/**
 * Applies a partial change on top of what is stored. Keys the change doesn't name keep their current value, which for a key
 * whose prerequisite is off is off: turning the prerequisite back on doesn't bring it back, whatever is stored or missing,
 * because the settings form shows it off and an admin turns it on by name. Switching a key off switches off what needs it, in
 * the same change, and never fails, because it may be how an institution stops something in a hurry. Asking for a key while
 * what it needs was off and stays off is the one conflict.
 */
export function applyFeatureChange(type: TenantType, stored: Partial<TenantFeatures> | null | undefined, change: Partial<TenantFeatures>): FeatureChangeResult {
  const before = resolveFeatures(type, stored);
  const kept: Partial<TenantFeatures> = {};
  for (const f of TENANT_FEATURES) {
    const needs = FEATURE_PREREQUISITES[f];
    if (needs && change[f] === undefined && !before[needs]) kept[f] = before[f];
  }
  const features = resolveFeatures(type, { ...stored, ...kept, ...change });
  const conflict =
    TENANT_FEATURES.find((f) => {
      const needs = FEATURE_PREREQUISITES[f];
      return !!needs && change[f] === true && !before[needs] && !features[needs];
    }) ?? null;
  return { features, conflict };
}

/** An institution becoming a school: the school-off keys go off, and `forcedOff` names those that were on, for the audit log. */
export function retypeToSchool(fromType: TenantType, stored: Partial<TenantFeatures> | null | undefined): { features: TenantFeatures; forcedOff: TenantFeature[] } {
  const before = resolveFeatures(fromType, stored);
  const { features } = applyFeatureChange("SCHOOL", stored, Object.fromEntries(SCHOOL_OFF_FEATURES.map((f) => [f, false])));
  return { features, forcedOff: SCHOOL_OFF_FEATURES.filter((f) => before[f]) };
}

/** The keys `edited` changes from `saved`. A settings form sends only these, so a stale tab can't undo another admin's change. */
export function changedFeatures(saved: TenantFeatures, edited: TenantFeatures): Partial<TenantFeatures> {
  return Object.fromEntries(TENANT_FEATURES.filter((f) => edited[f] !== saved[f]).map((f) => [f, edited[f]]));
}

/**
 * Whether a member of a school is still a pupil, and so kept out of private contact however the school sets its features.
 * Schools only, with the year read in the institution's time zone. A future batch year always counts. Otherwise a date of
 * birth decides: under 18 counts, 18 or over doesn't, even in the current batch year. With no date of birth, the current
 * batch year counts, because they may still be at school.
 */
export function isCurrentPupil(tenant: { type: TenantType; timezone: string }, member: { batchYear: number; dateOfBirth: string | null }, now: Date = new Date()): boolean {
  if (tenant.type !== "SCHOOL") return false;
  const today = wallPartsInZone(now, tenant.timezone);
  if (member.batchYear > today.year) return true;
  if (!member.dateOfBirth) return member.batchYear === today.year;
  const [year = 0, month = 0, day = 0] = member.dateOfBirth.split("-").map(Number);
  // As numbers, YYYYMMDD compares like a date. Someone born on 29 February turns 18 on 1 March in a common year.
  return today.year * 10000 + today.month * 100 + today.day < (year + 18) * 10000 + month * 100 + day;
}
