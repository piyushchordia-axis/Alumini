import { homeSection, SECTION_LABELS, type MemberSection, type TenantFeatures } from "@illuminize/shared";
import type { NavIconName } from "@/components/icons";

export interface SectionLink {
  path: string;
  label: string;
  icon: NavIconName;
}

export const SECTION_LINKS: Record<MemberSection, SectionLink> = {
  feed: { path: "feed", label: SECTION_LABELS.feed, icon: "feed" },
  messages: { path: "messages", label: SECTION_LABELS.messages, icon: "messages" },
  jobs: { path: "jobs", label: SECTION_LABELS.jobs, icon: "jobs" },
  directory: { path: "directory", label: SECTION_LABELS.directory, icon: "directory" },
  events: { path: "events", label: SECTION_LABELS.events, icon: "events" },
  groups: { path: "groups", label: SECTION_LABELS.groups, icon: "groups" },
  mentors: { path: "mentors", label: SECTION_LABELS.mentors, icon: "mentors" },
  businesses: { path: "businesses", label: SECTION_LABELS.businesses, icon: "businesses" },
  funding: { path: "funding", label: SECTION_LABELS.funding, icon: "funding" },
};

/** Where `/t/:slug/app` lands: the home section, or the profile when every section is off. */
export function homePath(slug: string, features: TenantFeatures): string {
  const home = homeSection(features);
  return `/t/${slug}/app/${home ? SECTION_LINKS[home].path : "profile"}`;
}
