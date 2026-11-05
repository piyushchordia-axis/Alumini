import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { usePollInterval } from "@/lib/realtime";

/**
 * The admin console's counts. The console polls them (`poll`, slowly while live updates are connected); anything else on
 * the same key, such as the More row, shares the answer without polling, so the count is the same everywhere.
 */
export function useAdminDashboard(slug: string, { enabled = true, poll = false }: { enabled?: boolean; poll?: boolean } = {}) {
  const interval = usePollInterval();
  return useQuery({ queryKey: qk.admin.dashboard(slug), queryFn: () => api.admin.dashboard(slug), enabled, refetchInterval: poll ? interval : false });
}
