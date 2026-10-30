import { Navigate, Outlet } from "react-router-dom";
import { useMembership } from "@/hooks/useMembership";

export function RequireTenantAdmin() {
  const { isTenantAdmin, tenant } = useMembership();
  if (!isTenantAdmin) return <Navigate to={`/t/${tenant.slug}/app`} replace />;
  return <Outlet />;
}
