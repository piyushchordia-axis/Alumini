import { homeSection, type ChatBadgeDto, type MemberSection, type TenantFeatures } from "@illuminize/shared";
import { chatBadgeLabel, groupsBadgeLabel, type ChatBadgeLabel } from "@illuminize/shared/chat";
import type { NavIconName } from "@/components/icons";

export interface SectionTab {
  /** The route folder under (app)/(tabs), which is also the URL segment. */
  path: string;
  label: string;
  icon: NavIconName;
}

export const SECTION_TABS: Record<MemberSection, SectionTab> = {
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

/** Where a member lands: the home section, or their profile when every section is off. */
export function homeHref(slug: string, features: TenantFeatures): `/t/${string}` {
  const home = homeSection(features);
  return `/t/${slug}/${home ? SECTION_TABS[home].path : "profile"}`;
}

/** The badges sections have, the same on the tab bar and in the More hub: unread chats on Messages, invitations on Groups. */
export function sectionBadges(badge: ChatBadgeDto | undefined): Partial<Record<MemberSection, ChatBadgeLabel>> {
  return { messages: chatBadgeLabel(badge), groups: groupsBadgeLabel(badge) };
}
