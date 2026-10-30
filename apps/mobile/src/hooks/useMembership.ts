import type { MembershipDto, TenantPublicDto } from "@illuminize/shared";
import { useQuery } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { useAuthStore } from "@/stores/authStore";

export function useMembershipQuery(slug: string | undefined) {
  const authed = useAuthStore((s) => s.isAuthenticated);
  return useQuery({ queryKey: qk.membership(slug ?? ""), queryFn: () => api.membership.me(slug!), enabled: !!slug && authed, retry: false, staleTime: 30_000 });
}

export interface MembershipContextValue {
  tenant: TenantPublicDto;
  membership: MembershipDto;
  isTenantAdmin: boolean;
}

export const MembershipContext = createContext<MembershipContextValue | null>(null);

export function useMembership(): MembershipContextValue {
  const v = useContext(MembershipContext);
  if (!v) throw new Error("useMembership must be used inside the (app) layout");
  return v;
}
