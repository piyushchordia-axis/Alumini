import { jobsQuery, referralKeys, referralsAvailable, type JobsTab, type ReferralBox, type ReferralSummaryDto } from "@illuminize/shared";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { refreshChat } from "@/lib/chat";

/** A tab of the Jobs section, and on Referrals one of its lists: the same URLs the referral notifications open. */
export const jobsHref = (slug: string, tab: JobsTab = "openings", box?: ReferralBox) => `/t/${slug}/jobs${jobsQuery(tab, box)}` as const;
export const jobHref = (slug: string, jobId: string) => `/t/${slug}/jobs/${jobId}` as const;
/** The request form, in the Jobs stack above the job it's about. */
export const referralRequestHref = (slug: string, jobId: string) => `/t/${slug}/jobs/request-referral/${jobId}` as const;

/** Notifications that a referral request changed on the other side, so a push refetches its lists and its job's page. */
export const REFERRAL_TYPES: ReadonlySet<string> = new Set(["REFERRAL_REQUESTED", "REFERRAL_ACCEPTED", "REFERRAL_DECLINED"]);

/** After anything that changes a referral request: every list, the summary, and every job's page, which says where the viewer's own request stands. */
export function refreshReferrals(qc: QueryClient, slug: string) {
  return Promise.all([qc.invalidateQueries({ queryKey: referralKeys.all(slug) }), qc.invalidateQueries({ queryKey: ["job", slug] })]);
}

/** After accepting, which opens a chat too. */
export function refreshReferralsAndChat(qc: QueryClient, slug: string) {
  return Promise.all([refreshReferrals(qc, slug), refreshChat(qc, slug)]);
}

/** Whether this member can ask for referrals and answer them here now: they're on (jobs and messaging), and the member isn't a current pupil. */
export function useReferralsAvailable(): boolean {
  const { tenant, membership } = useMembership();
  return referralsAvailable(tenant.settings.features, membership.chatEligible);
}

/**
 * For a member who can't use referrals now: how many requests still wait in each of their lists, which only the Referrals
 * tab lets them withdraw or answer. Asks only while referrals are off for them, and null until it knows.
 */
export function useReferralsWayOut(): ReferralSummaryDto | null {
  const { tenant } = useMembership();
  const off = !useReferralsAvailable();
  const summary = useQuery({ queryKey: referralKeys.summary(tenant.slug), queryFn: () => api.jobs.referrals.summary(tenant.slug), enabled: off, staleTime: 60_000 });
  return off ? (summary.data ?? null) : null;
}
