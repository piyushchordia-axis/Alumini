import type { MembershipDto, TenantPublicDto } from "@illuminize/shared";
import { createContext, useContext } from "react";

/**
 * Context for the institution admin pages. `me` is the viewer's own approved membership, or null for Illuminize
 * staff (platform admins) who manage an institution they are not a member of.
 */
export interface AdminContextValue {
  tenant: TenantPublicDto;
  me: MembershipDto | null;
  isPlatformAdmin: boolean;
}

export const AdminContext = createContext<AdminContextValue | null>(null);

export function useAdminTenant(): AdminContextValue {
  const v = useContext(AdminContext);
  if (!v) throw new Error("useAdminTenant must be used inside RequireTenantAdmin");
  return v;
}
