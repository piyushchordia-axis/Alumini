import { mentorsQuery, mentorshipAvailable, mentorshipKeys, type MentorsTab, type MentorshipBox } from "@illuminize/shared";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { refreshChat } from "@/lib/chat";

export const mentorsPath = (slug: string, tab: MentorsTab = "find", box?: MentorshipBox) => `/t/${slug}/app/mentors${mentorsQuery(tab, box)}`;
export const mentorPath = (slug: string, membershipId: string) => `/t/${slug}/app/mentors/${membershipId}`;
export const mentorRequestPath = (slug: string, membershipId: string) => `/t/${slug}/app/mentors/${membershipId}/request`;

/** After anything that changes a request or a mentor: every list, every mentor's page and the member's own profile. */
export function refreshMentorship(qc: QueryClient, slug: string) {
  return qc.invalidateQueries({ queryKey: mentorshipKeys.all(slug) });
}

/** After accepting or ending, which opens or closes a chat too. */
export function refreshMentorshipAndChat(qc: QueryClient, slug: string) {
  return Promise.all([refreshMentorship(qc, slug), refreshChat(qc, slug)]);
}

/**
 * Whether the navigation keeps Mentors for a member who can't use mentorship now (it's switched off, or they're a current
 * pupil) because they're still listed as a mentor or have a request or mentorship open there, which only that screen lets
 * them leave. Asks only while mentorship is off for them.
 */
export function useMentorsWayOut(): boolean {
  const { tenant, membership } = useMembership();
  const off = !mentorshipAvailable(tenant.settings.features, membership.chatEligible);
  const summary = useQuery({ queryKey: mentorshipKeys.summary(tenant.slug), queryFn: () => api.mentorship.summary(tenant.slug), enabled: off, staleTime: 60_000 });
  return off && !!summary.data && (summary.data.listed || summary.data.open > 0);
}
