import { isApiClientError } from "@illuminize/shared/client";
import { useEffect } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { TenantLoadError } from "@/components/common/TenantLoadError";
import { Loading } from "@/components/ui";
import { AdminContext } from "@/hooks/useAdminTenant";
import { useMe } from "@/hooks/useMe";
import { useMembershipQuery } from "@/hooks/useMembership";
import { useTenant } from "@/hooks/useTenant";
import { useTenantSlug } from "@/hooks/useTenantSlug";
import { applyTenantTheme } from "@/lib/theme";
import { useAuthStore } from "@/stores/authStore";

/**
 * Lets institution admins (approved members with the admin role) and Illuminize staff into /t/:slug/admin. Staff do
 * not need a membership of the institution, matching the API's `requireTenantAdmin`.
 */
export function RequireTenantAdmin() {
  const slug = useTenantSlug();
  const tenant = useTenant(slug);
  const membership = useMembershipQuery(slug);
  const me = useMe();
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    if (tenant.data) applyTenantTheme(tenant.data);
  }, [tenant.data]);

  if (tenant.isLoading || membership.isLoading || (me.isLoading && !user)) return <Loading />;
  if (tenant.error) return <TenantLoadError error={tenant.error} onRetry={() => void tenant.refetch()} />;
  if (!tenant.data) return <Loading />;

  const isPlatformAdmin = !!user?.isPlatformAdmin;
  const m = membership.data?.status === "APPROVED" ? membership.data : null;
  const isAdminMember = m?.role === "TENANT_ADMIN";
  if (!isPlatformAdmin && !isAdminMember) {
    const notMember = isApiClientError(membership.error) && (membership.error.code === "NOT_A_MEMBER" || membership.error.status === 404);
    if (membership.error && !notMember) return <TenantLoadError error={membership.error} onRetry={() => void membership.refetch()} />;
    return <Navigate to={`/t/${slug}/app`} replace />;
  }
  return (
    <AdminContext.Provider value={{ tenant: tenant.data, me: m, isPlatformAdmin }}>
      <Outlet />
    </AdminContext.Provider>
  );
}
