import { homeSection, type MemberSection, type TenantFeatures } from "@illuminize/shared";

export interface SectionLink {
  path: string;
  label: string;
  icon: string;
}

export const SECTION_LINKS: Record<MemberSection, SectionLink> = {
  feed: { path: "feed", label: "Feed", icon: "💬" },
  messages: { path: "messages", label: "Messages", icon: "✉️" },
  jobs: { path: "jobs", label: "Jobs", icon: "💼" },
  directory: { path: "directory", label: "Directory", icon: "🎓" },
  events: { path: "events", label: "Events", icon: "📅" },
  businesses: { path: "businesses", label: "Businesses", icon: "🏪" },
  funding: { path: "funding", label: "Funding", icon: "🚀" },
};

/** Where `/t/:slug/app` lands: the home section, or the profile when every section is off. */
export function homePath(slug: string, features: TenantFeatures): string {
  const home = homeSection(features);
  return `/t/${slug}/app/${home ? SECTION_LINKS[home].path : "profile"}`;
}
