import type { TenantFeature, TenantFeatures } from "@illuminize/shared";

/** Member app tabs in order; each can be switched off per institution. */
export const SECTIONS: TenantFeature[] = ["feed", "jobs", "funding", "events", "directory"];

/** Where a member lands: the first enabled section, or their profile when every section is off. */
export function homeHref(slug: string, features: TenantFeatures): `/t/${string}` {
  const first = SECTIONS.find((s) => features[s]);
  return `/t/${slug}/${first ?? "profile"}`;
}
