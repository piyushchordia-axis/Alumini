import { homeSection, type ChatBadgeDto, type MemberSection, type TenantFeatures } from "@illuminize/shared";
import { chatBadgeLabel, groupsBadgeLabel, type ChatBadgeLabel } from "@illuminize/shared/chat";

export interface SectionTab {
  /** The route folder under (app)/(tabs), which is also the URL segment. */
  path: string;
  label: string;
  icon: string;
}

export const SECTION_TABS: Record<MemberSection, SectionTab> = {
  feed: { path: "feed", label: "Feed", icon: "💬" },
  messages: { path: "messages", label: "Messages", icon: "✉️" },
  jobs: { path: "jobs", label: "Jobs", icon: "💼" },
  directory: { path: "directory", label: "Directory", icon: "🎓" },
  events: { path: "events", label: "Events", icon: "📅" },
  groups: { path: "groups", label: "Groups", icon: "👥" },
  businesses: { path: "businesses", label: "Businesses", icon: "🏪" },
  funding: { path: "funding", label: "Funding", icon: "🚀" },
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
