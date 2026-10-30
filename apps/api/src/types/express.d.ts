import type { AuthContext, MembershipRow, TenantContext } from "./request";

declare global {
  namespace Express {
    interface Request {
      id: string;
      auth?: AuthContext;
      tenantCtx?: TenantContext;
      /** Caller's membership in the resolved tenant (null when none). */
      membership?: MembershipRow | null;
    }
  }
}

export {};
