import { homeSection, type MemberSection, type TenantFeatures } from "@illuminize/shared";
import type { NavIconName } from "@/components/icons";

export interface SectionLink {
  path: string;
  label: string;
  icon: NavIconName;
}

export const SECTION_LINKS: Record<MemberSection, SectionLink> = {
  feed: { path: "feed", label: "Feed", icon: "feed" },
  messages: { path: "messages", label: "Messages", icon: "messages" },
  jobs: { path: "jobs", label: "Jobs", icon: "jobs" },
  directory: { path: "directory", label: "Directory", icon: "directory" },
  events: { path: "events", label: "Events", icon: "events" },
  groups: { path: "groups", label: "Groups", icon: "groups" },
  mentors: { path: "mentors", label: "Mentors", icon: "mentors" },
  businesses: { path: "businesses", label: "Businesses", icon: "businesses" },
  funding: { path: "funding", label: "Funding", icon: "funding" },
};

/** Where `/t/:slug/app` lands: the home section, or the profile when every section is off. */
export function homePath(slug: string, features: TenantFeatures): string {
  const home = homeSection(features);
  return `/t/${slug}/app/${home ? SECTION_LINKS[home].path : "profile"}`;
}
