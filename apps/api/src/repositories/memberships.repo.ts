import { desc, eq } from "drizzle-orm";
import type { DbClient } from "../db/client";
import { memberships, tenants } from "../db/schema";
import type { MembershipRow, TenantRow } from "../types/request";

export async function listMembershipsForUser(db: DbClient, userId: string): Promise<Array<{ membership: MembershipRow; tenant: TenantRow }>> {
  return db
    .select({ membership: memberships, tenant: tenants })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(eq(memberships.userId, userId))
    .orderBy(desc(memberships.createdAt));
}
