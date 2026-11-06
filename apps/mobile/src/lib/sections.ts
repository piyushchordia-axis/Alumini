import { homeSection, SECTION_LABELS, type MemberSection, type TenantFeatures } from "@illuminize/shared";
import type { NavIconName } from "@/components/icons";

export interface SectionTab {
  /** The route folder under (app)/(tabs), which is also the URL segment. */
  path: string;
  label: string;
  icon: NavIconName;
}

export const SECTION_TABS: Record<MemberSection, SectionTab> = {
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

/** Where a member lands: the home section, or their profile when every section is off. */
export function homeHref(slug: string, features: TenantFeatures): `/t/${string}` {
  const home = homeSection(features);
  return `/t/${slug}/${home ? SECTION_TABS[home].path : "profile"}`;
}
