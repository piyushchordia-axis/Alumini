import { mentorsQuery, mentorshipAvailable, mentorshipKeys, type MentorsTab, type MentorshipBox } from "@illuminize/shared";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { refreshChat } from "@/lib/chat";

/** A tab of the Mentors section, and on Requests one of its lists: the same URLs the mentorship notifications open. */
export const mentorsHref = (slug: string, tab: MentorsTab = "find", box?: MentorshipBox) => `/t/${slug}/mentors${mentorsQuery(tab, box)}` as const;
/** A mentor's page and the request form, which sit above the tabs. */
export const mentorHref = (slug: string, membershipId: string) => `/t/${slug}/mentors/${membershipId}` as const;
export const mentorRequestHref = (slug: string, membershipId: string) => `/t/${slug}/mentors/request/${membershipId}` as const;
export const chatHref = (slug: string, conversationId: string) => `/t/${slug}/messages/${conversationId}` as const;

/** Notifications that a request or mentorship changed on the other side, so a push refetches its lists and its mentor's page. */
export const MENTORSHIP_TYPES: ReadonlySet<string> = new Set(["MENTORSHIP_REQUESTED", "MENTORSHIP_ACCEPTED", "MENTORSHIP_DECLINED", "MENTORSHIP_ENDED"]);

/** After anything that changes a request or a mentor: every list, every mentor's page and the member's own profile. */
export function refreshMentorship(qc: QueryClient, slug: string) {
  return qc.invalidateQueries({ queryKey: mentorshipKeys.all(slug) });
}

/** After accepting or ending, which opens or closes a chat too. */
export function refreshMentorshipAndChat(qc: QueryClient, slug: string) {
  return Promise.all([refreshMentorship(qc, slug), refreshChat(qc, slug)]);
}

/**
 * Whether the tabs keep Mentors, behind More, for a member who can't use mentorship now (it's switched off, or they're a
 * current pupil) because they're still listed as a mentor or have a request or mentorship open there, which only that screen
 * lets them leave. Asks only while mentorship is off for them.
 */
export function useMentorsWayOut(): boolean {
  const { tenant, membership } = useMembership();
  const off = !mentorshipAvailable(tenant.settings.features, membership.chatEligible);
  const summary = useQuery({ queryKey: mentorshipKeys.summary(tenant.slug), queryFn: () => api.mentorship.summary(tenant.slug), enabled: off, staleTime: 60_000 });
  return off && !!summary.data && (summary.data.listed || summary.data.open > 0);
}
