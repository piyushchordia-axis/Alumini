import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

/** The institution's own profile questions, as the signed-in person's form shows them. */
export function useProfileFields(slug: string, enabled = true) {
  return useQuery({ queryKey: qk.profileFields(slug), queryFn: () => api.membership.profileFields(slug), enabled, staleTime: 60_000 });
}
