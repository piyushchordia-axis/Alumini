import { SECTION_LABELS, type MemberSection } from "@illuminize/shared";
import type { NavIconName } from "@/components/icons";
import { SECTION_PATHS } from "./entry";

export { entryHref, homeHref, isWelcomePath, welcomeHref } from "./entry";

export interface SectionTab {
  /** The route folder under (app)/(tabs), which is also the URL segment. */
  path: string;
  label: string;
  icon: NavIconName;
}

export const SECTION_TABS: Record<MemberSection, SectionTab> = {
  feed: { path: SECTION_PATHS.feed, label: SECTION_LABELS.feed, icon: "feed" },
  messages: { path: SECTION_PATHS.messages, label: SECTION_LABELS.messages, icon: "messages" },
  jobs: { path: SECTION_PATHS.jobs, label: SECTION_LABELS.jobs, icon: "jobs" },
  directory: { path: SECTION_PATHS.directory, label: SECTION_LABELS.directory, icon: "directory" },
  events: { path: SECTION_PATHS.events, label: SECTION_LABELS.events, icon: "events" },
  groups: { path: SECTION_PATHS.groups, label: SECTION_LABELS.groups, icon: "groups" },
  mentors: { path: SECTION_PATHS.mentors, label: SECTION_LABELS.mentors, icon: "mentors" },
  businesses: { path: SECTION_PATHS.businesses, label: SECTION_LABELS.businesses, icon: "businesses" },
  funding: { path: SECTION_PATHS.funding, label: SECTION_LABELS.funding, icon: "funding" },
};
