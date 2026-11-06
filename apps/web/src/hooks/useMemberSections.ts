import { chatAvailable, splitSections, type MemberSection } from "@illuminize/shared";
import { moreBadgeLabel, sectionBadges, type ChatBadgeLabel } from "@illuminize/shared/chat";
import { useChatBadge } from "@/hooks/useChat";
import { useMembership } from "@/hooks/useMembership";
import { useMentorsWayOut } from "@/lib/mentors";
import { SECTION_LINKS, type SectionLink } from "@/lib/sections";

export interface MemberSectionLink extends SectionLink {
  section: MemberSection;
  to: string;
}

/**
 * This member's sections as the navigation shows them: `bar` on a phone's bottom bar (and first in the sidebar),
 * `overflow` behind More, with the badges they carry. Everything that lists sections reads them here, so no two places
 * disagree. The badge shares the app's chat query, and a member who can't use chat (a current pupil) asks for none.
 */
export function useMemberSections() {
  const { tenant, membership } = useMembership();
  const features = tenant.settings.features;
  const mentorsWayOut = useMentorsWayOut();
  const { bar, overflow } = splitSections(features, membership.chatEligible, { mentorsWayOut });
  const badges = sectionBadges(useChatBadge(tenant.slug, chatAvailable(features, membership.chatEligible)).data);
  const toLink = (section: MemberSection): MemberSectionLink => ({ ...SECTION_LINKS[section], section, to: `/t/${tenant.slug}/app/${SECTION_LINKS[section].path}` });
  /** The badge on a section's link, for a section with something to count. */
  const badgeFor = (section: MemberSection): ChatBadgeLabel | null => {
    const badge = badges[section];
    return badge && badge.count > 0 ? badge : null;
  };
  return { bar, overflow, toLink, badgeFor, moreBadge: moreBadgeLabel(overflow, badges), mentorsWayOut };
}
