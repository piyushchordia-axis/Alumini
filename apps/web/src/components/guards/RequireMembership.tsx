import { isApiClientError } from "@illuminize/shared/client";
import { useEffect } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { TenantLoadError } from "@/components/common/TenantLoadError";
import { Loading } from "@/components/ui";
import { MembershipContext } from "@/hooks/useMembership";
import { useMembershipQuery } from "@/hooks/useMembership";
import { useTenant } from "@/hooks/useTenant";
import { useTenantSlug } from "@/hooks/useTenantSlug";
import { applyTenantTheme } from "@/lib/theme";
import { useAuthStore } from "@/stores/authStore";
import { useUiStore } from "@/stores/uiStore";

/** Ensures the signed-in user has an APPROVED membership of the tenant; otherwise routes to register/pending. */
export function RequireMembership() {
  const slug = useTenantSlug();
  const tenant = useTenant(slug);
  const membership = useMembershipQuery(slug);
  const user = useAuthStore((s) => s.user);
  const lastSlug = useUiStore((s) => s.lastTenantSlug);
  const setLast = useUiStore((s) => s.setLastTenantSlug);
  const approved = membership.data?.status === "APPROVED";

  useEffect(() => {
    if (tenant.data) applyTenantTheme(tenant.data);
  }, [tenant.data]);

  // Only remember institutions the user can actually open, so the start page never bounces them back into a
  // waiting or rejected screen.
  useEffect(() => {
    if (approved) setLast(slug);
    else if ((membership.data || membership.error) && lastSlug === slug) setLast(null);
  }, [approved, membership.data, membership.error, lastSlug, slug, setLast]);

  if (tenant.isLoading || membership.isLoading) return <Loading />;
  if (tenant.error) return <TenantLoadError error={tenant.error} onRetry={() => void tenant.refetch()} />;
  if (membership.error) {
    if (isApiClientError(membership.error) && (membership.error.code === "NOT_A_MEMBER" || membership.error.status === 404)) return <Navigate to={`/t/${slug}/register`} replace />;
    return <TenantLoadError error={membership.error} onRetry={() => void membership.refetch()} />;
  }
  if (!tenant.data || !membership.data) return <Loading />;
  if (!approved) return <Navigate to={`/t/${slug}/pending`} replace />;

  const isPlatformAdmin = !!user?.isPlatformAdmin;
  return (
    <MembershipContext.Provider value={{ tenant: tenant.data, membership: membership.data, isTenantAdmin: membership.data.role === "TENANT_ADMIN" || isPlatformAdmin, isPlatformAdmin }}>
      <Outlet />
    </MembershipContext.Provider>
  );
}
