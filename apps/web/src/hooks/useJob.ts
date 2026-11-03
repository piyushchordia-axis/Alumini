import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

/** One job's page, shared by its edit form and the referral request form, which need the same job and the viewer's own request on it. */
export function useJob(slug: string, jobId: string, enabled = true) {
  return useQuery({ queryKey: qk.job(slug, jobId), queryFn: () => api.jobs.get(slug, jobId), enabled });
}
