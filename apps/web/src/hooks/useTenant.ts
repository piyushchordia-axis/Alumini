import { GUARD_QUERY_META } from "@illuminize/shared/client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

export function useTenant(slug: string) {
  return useQuery({ queryKey: qk.tenant(slug), queryFn: () => api.tenants.get(slug), staleTime: 5 * 60_000, meta: GUARD_QUERY_META });
}

export function useTenantList(q?: string) {
  return useQuery({ queryKey: [...qk.tenants, q ?? ""], queryFn: () => api.tenants.list(q), staleTime: 60_000 });
}
