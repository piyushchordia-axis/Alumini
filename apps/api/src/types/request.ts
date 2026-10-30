import type { memberships, tenantSettings, tenants } from "../db/schema";

export interface AuthContext {
  userId: string;
  sid: string;
  isPlatformAdmin: boolean;
}

export type TenantRow = typeof tenants.$inferSelect;
export type TenantSettingsRow = typeof tenantSettings.$inferSelect;
export type MembershipRow = typeof memberships.$inferSelect;

export interface TenantContext {
  tenant: TenantRow;
  settings: TenantSettingsRow;
}
