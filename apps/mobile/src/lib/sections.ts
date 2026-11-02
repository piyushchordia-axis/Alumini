import { homeSection, type MemberSection, type TenantFeatures } from "@illuminize/shared";

export interface SectionTab {
  /** The route folder under (app)/(tabs), which is also the URL segment. */
  path: string;
  label: string;
  icon: string;
}

export const SECTION_TABS: Record<MemberSection, SectionTab> = {
  feed: { path: "feed", label: "Feed", icon: "💬" },
  jobs: { path: "jobs", label: "Jobs", icon: "💼" },
  directory: { path: "directory", label: "Directory", icon: "🎓" },
  events: { path: "events", label: "Events", icon: "📅" },
  funding: { path: "funding", label: "Funding", icon: "🚀" },
};

/** Where a member lands: the home section, or their profile when every section is off. */
export function homeHref(slug: string, features: TenantFeatures): `/t/${string}` {
  const home = homeSection(features);
  return `/t/${slug}/${home ? SECTION_TABS[home].path : "profile"}`;
}
