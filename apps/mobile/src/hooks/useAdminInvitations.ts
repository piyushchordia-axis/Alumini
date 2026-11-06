import { useQuery, type QueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

/** The invitations' counts, the plan's channels and today's sending room, for the list and the import. */
export function useInvitationSummary(slug: string) {
  return useQuery({ queryKey: qk.admin.invitationSummary(slug), queryFn: () => api.admin.invitations.summary(slug) });
}

/**
 * After anything that changes invitations, even a refusal (a 409 for a plan that no longer sends means the summary is out
 * of date): every list of them and the summary, which share the prefix.
 */
export function refreshInvitations(qc: QueryClient, slug: string) {
  return qc.invalidateQueries({ queryKey: qk.admin.invitations(slug).slice(0, 3) });
}
