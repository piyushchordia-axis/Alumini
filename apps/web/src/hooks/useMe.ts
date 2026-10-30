import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { useAuthStore } from "@/stores/authStore";

/** Fetches /me when signed in and keeps the auth store's user/memberships fresh. */
export function useMe(enabled = true) {
  const token = useAuthStore((s) => s.accessToken);
  const setUser = useAuthStore((s) => s.setUser);
  const query = useQuery({ queryKey: qk.me, queryFn: () => api.me.get(), enabled: enabled && !!token, staleTime: 60_000 });
  useEffect(() => {
    if (query.data) setUser(query.data.user, query.data.memberships);
  }, [query.data, setUser]);
  return query;
}
