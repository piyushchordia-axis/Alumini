import type { TenantFeature, TenantFeatures } from "@illuminize/shared";

export interface AppSection {
  feature: TenantFeature;
  path: string;
  label: string;
  icon: string;
}

/** The member app's main sections, in navigation order. Each one can be switched off per institution. */
export const APP_SECTIONS: AppSection[] = [
  { feature: "feed", path: "feed", label: "Feed", icon: "💬" },
  { feature: "jobs", path: "jobs", label: "Jobs", icon: "💼" },
  { feature: "funding", path: "funding", label: "Funding", icon: "🚀" },
  { feature: "events", path: "events", label: "Events", icon: "📅" },
  { feature: "directory", path: "directory", label: "Directory", icon: "🎓" },
];

export function enabledSections(features: TenantFeatures): AppSection[] {
  return APP_SECTIONS.filter((s) => features[s.feature] ?? true);
}

/** Where `/t/:slug/app` lands: the first enabled section, or the profile when every section is off. */
export function homePath(slug: string, features: TenantFeatures): string {
  const first = enabledSections(features)[0];
  return `/t/${slug}/app/${first ? first.path : "profile"}`;
}
