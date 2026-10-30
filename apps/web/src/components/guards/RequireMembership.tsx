import { isApiClientError } from "@illuminize/shared/client";
import { useEffect } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { Loading, ErrorBox } from "@/components/ui";
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
  const setLast = useUiStore((s) => s.setLastTenantSlug);

  useEffect(() => {
    if (tenant.data) {
      applyTenantTheme(tenant.data);
      setLast(tenant.data.slug);
    }
  }, [tenant.data, setLast]);

  if (tenant.isLoading || membership.isLoading) return <Loading />;
  if (tenant.error) return <ErrorBox error={tenant.error} className="m-6" />;
  if (membership.error) {
    if (isApiClientError(membership.error)) {
      if (membership.error.code === "NOT_A_MEMBER" || membership.error.status === 404) return <Navigate to={`/t/${slug}/register`} replace />;
      if (membership.error.code === "TENANT_INACTIVE") return <ErrorBox error={membership.error} className="m-6" />;
    }
    return <ErrorBox error={membership.error} className="m-6" />;
  }
  if (!tenant.data || !membership.data) return <Loading />;
  if (membership.data.status !== "APPROVED") return <Navigate to={`/t/${slug}/pending`} replace />;

  const isPlatformAdmin = !!user?.isPlatformAdmin;
  return (
    <MembershipContext.Provider value={{ tenant: tenant.data, membership: membership.data, isTenantAdmin: membership.data.role === "TENANT_ADMIN" || isPlatformAdmin, isPlatformAdmin }}>
      <Outlet />
    </MembershipContext.Provider>
  );
}
