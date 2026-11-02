import { TENANT_FEATURES, type TenantFeature, type TenantFeatures, type TenantType } from "../constants";

/** Keys that start off for schools and that retyping an institution to SCHOOL forces off. Its admin can turn them on. */
export const SCHOOL_OFF_FEATURES: readonly TenantFeature[] = [];

/** What each key needs: a key reads as off while what it needs is off. One level deep, so a prerequisite has none of its own. */
export const FEATURE_PREREQUISITES: Readonly<Partial<Record<TenantFeature, TenantFeature>>> = {};

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

/** Applies a partial change on top of what is stored. Keys the change doesn't name keep their current value. */
export function applyFeatureChange(type: TenantType, stored: Partial<TenantFeatures> | null | undefined, change: Partial<TenantFeatures>): FeatureChangeResult {
  return { features: resolveFeatures(type, { ...stored, ...change }), conflict: null };
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
