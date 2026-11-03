import { jobsQuery, referralKeys, referralsAvailable, type JobsTab, type ReferralBox } from "@illuminize/shared";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { refreshChat } from "@/lib/chat";

export const jobsPath = (slug: string, tab: JobsTab = "openings", box?: ReferralBox) => `/t/${slug}/app/jobs${jobsQuery(tab, box)}`;
export const jobPath = (slug: string, jobId: string) => `/t/${slug}/app/jobs/${jobId}`;
export const referralRequestPath = (slug: string, jobId: string) => `/t/${slug}/app/jobs/${jobId}/request-referral`;

/** After anything that changes a referral request: every list, the summary, and every job's page, which says where the viewer's own request stands. */
export function refreshReferrals(qc: QueryClient, slug: string) {
  return Promise.all([qc.invalidateQueries({ queryKey: referralKeys.all(slug) }), qc.invalidateQueries({ queryKey: ["job", slug] })]);
}

/** After accepting, which opens a chat too. */
export function refreshReferralsAndChat(qc: QueryClient, slug: string) {
  return Promise.all([refreshReferrals(qc, slug), refreshChat(qc, slug)]);
}

/** Whether this member can ask for referrals and answer them here now. */
export function useReferralsAvailable(): boolean {
  const { tenant, membership } = useMembership();
  return referralsAvailable(tenant.settings.features, membership.chatEligible);
}

/**
 * For a member who can't use referrals now (they're switched off, or the member is a current pupil): how many requests
 * still wait in each of their lists, which only the Referrals tab lets them withdraw or answer. Asks only while referrals
 * are off for them, and null until it knows.
 */
export function useReferralsWayOut(): { received: number; sent: number } | null {
  const { tenant } = useMembership();
  const off = !useReferralsAvailable();
  const summary = useQuery({ queryKey: referralKeys.summary(tenant.slug), queryFn: () => api.jobs.referrals.summary(tenant.slug), enabled: off, staleTime: 60_000 });
  return off ? (summary.data ?? null) : null;
}
