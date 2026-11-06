import { chatAvailable, splitSections, type MemberSection } from "@illuminize/shared";
import { moreBadgeLabel, sectionBadges, type ChatBadgeLabel } from "@illuminize/shared/chat";
import { useChatBadge } from "@/hooks/useChat";
import { useMembership } from "@/hooks/useMembership";
import { useMentorsWayOut } from "@/lib/mentors";
import { SECTION_TABS, type SectionTab } from "@/lib/sections";

export interface MemberSectionLink extends SectionTab {
  section: MemberSection;
  href: `/t/${string}`;
}

/**
 * This member's sections as the navigation shows them: `bar` on the tab bar, `overflow` behind More, with the badges
 * they carry, the same as the web's. The tabs and More read them here, so they can't disagree. The badge shares the
 * app's chat query, and a member who can't use chat (a current pupil) asks for none.
 */
export function useMemberSections() {
  const { tenant, membership } = useMembership();
  const features = tenant.settings.features;
  const mentorsWayOut = useMentorsWayOut();
  const { bar, overflow } = splitSections(features, membership.chatEligible, { mentorsWayOut });
  const badges = sectionBadges(useChatBadge(tenant.slug, chatAvailable(features, membership.chatEligible)).data);
  const toLink = (section: MemberSection): MemberSectionLink => ({ ...SECTION_TABS[section], section, href: `/t/${tenant.slug}/${SECTION_TABS[section].path}` });
  /** The badge on a section's tab or row, for a section with something to count. */
  const badgeFor = (section: MemberSection): ChatBadgeLabel | null => {
    const badge = badges[section];
    return badge && badge.count > 0 ? badge : null;
  };
  return { bar, overflow, toLink, badgeFor, moreBadge: moreBadgeLabel(overflow, badges), mentorsWayOut };
}
