import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import type { DbClient } from "../db/client";
import { tenantSettings, tenants } from "../db/schema";
import type { TenantRow, TenantSettingsRow } from "../types/request";

export type TenantInsert = typeof tenants.$inferInsert;
export type TenantSettingsInsert = typeof tenantSettings.$inferInsert;

export async function findTenantBySlug(db: DbClient, slug: string): Promise<TenantRow | undefined> {
  const [row] = await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
  return row;
}

export async function findTenantById(db: DbClient, id: string): Promise<TenantRow | undefined> {
  const [row] = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
  return row;
}

export async function findTenantWithSettingsBySlug(
  db: DbClient,
  slug: string,
): Promise<{ tenant: TenantRow; settings: TenantSettingsRow } | undefined> {
  const [row] = await db
    .select({ tenant: tenants, settings: tenantSettings })
    .from(tenants)
    .innerJoin(tenantSettings, eq(tenantSettings.tenantId, tenants.id))
    .where(eq(tenants.slug, slug))
    .limit(1);
  return row;
}

export async function findTenantWithSettingsById(
  db: DbClient,
  id: string,
): Promise<{ tenant: TenantRow; settings: TenantSettingsRow } | undefined> {
  const [row] = await db
    .select({ tenant: tenants, settings: tenantSettings })
    .from(tenants)
    .innerJoin(tenantSettings, eq(tenantSettings.tenantId, tenants.id))
    .where(eq(tenants.id, id))
    .limit(1);
  return row;
}

export async function listActiveTenants(db: DbClient, q?: string): Promise<TenantRow[]> {
  const conditions = [eq(tenants.status, "ACTIVE")];
  if (q) {
    const pattern = `%${q.replace(/[%_]/g, "\\$&")}%`;
    conditions.push(or(ilike(tenants.name, pattern), ilike(tenants.shortName, pattern), ilike(tenants.city, pattern))!);
  }
  return db
    .select()
    .from(tenants)
    .where(and(...conditions))
    .orderBy(asc(tenants.name))
    .limit(200);
}

export async function findSettings(db: DbClient, tenantId: string): Promise<TenantSettingsRow | undefined> {
  const [row] = await db.select().from(tenantSettings).where(eq(tenantSettings.tenantId, tenantId)).limit(1);
  return row;
}

export async function insertTenant(db: DbClient, values: TenantInsert): Promise<TenantRow> {
  const [row] = await db.insert(tenants).values(values).returning();
  return row!;
}

export async function updateTenant(db: DbClient, id: string, values: Partial<TenantInsert>): Promise<TenantRow | undefined> {
  const [row] = await db
    .update(tenants)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(tenants.id, id))
    .returning();
  return row;
}

export async function upsertSettings(db: DbClient, values: TenantSettingsInsert): Promise<TenantSettingsRow> {
  const { tenantId, ...rest } = values;
  const [row] = await db
    .insert(tenantSettings)
    .values(values)
    .onConflictDoUpdate({ target: tenantSettings.tenantId, set: { ...rest, updatedAt: new Date() } })
    .returning();
  void tenantId;
  return row!;
}

export async function updateSettings(
  db: DbClient,
  tenantId: string,
  values: Partial<Omit<TenantSettingsInsert, "tenantId">>,
): Promise<TenantSettingsRow | undefined> {
  const [row] = await db
    .update(tenantSettings)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(tenantSettings.tenantId, tenantId))
    .returning();
  return row;
}

export async function countTenants(db: DbClient): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(tenants);
  return row?.count ?? 0;
}

export interface PlatformTenantFilters {
  q?: string;
  status?: TenantRow["status"];
  page: number;
  pageSize: number;
}

export interface TenantCountsRow {
  approvedMembers: number;
  pendingMembers: number;
  suspendedMembers: number;
  activeMembers30d: number;
  newMembers30d: number;
  billingModel: "PER_ACTIVE_USER" | "FLAT_FEE" | "FREE" | null;
}

const countsSelect = {
  approvedMembers: sql<number>`(select count(*) from memberships m where m.tenant_id = tenants.id and m.status = 'APPROVED')::int`,
  pendingMembers: sql<number>`(select count(*) from memberships m where m.tenant_id = tenants.id and m.status = 'PENDING')::int`,
  suspendedMembers: sql<number>`(select count(*) from memberships m where m.tenant_id = tenants.id and m.status = 'SUSPENDED')::int`,
  activeMembers30d: sql<number>`(select count(*) from memberships m where m.tenant_id = tenants.id and m.status = 'APPROVED' and m.last_active_at >= now() - interval '30 days')::int`,
  newMembers30d: sql<number>`(select count(*) from memberships m where m.tenant_id = tenants.id and m.created_at >= now() - interval '30 days')::int`,
  billingModel: sql<TenantCountsRow["billingModel"]>`(select bp.billing_model from tenant_billing_plans bp where bp.tenant_id = tenants.id and bp.effective_from <= current_date and (bp.effective_to is null or bp.effective_to >= current_date) order by bp.effective_from desc limit 1)`,
};

export async function listTenantsForPlatform(
  db: DbClient,
  f: PlatformTenantFilters,
): Promise<{ rows: Array<{ tenant: TenantRow } & TenantCountsRow>; total: number }> {
  const conds = [] as ReturnType<typeof eq>[];
  if (f.status) conds.push(eq(tenants.status, f.status));
  if (f.q) {
    const pattern = `%${f.q.replace(/[%_]/g, "\\$&")}%`;
    conds.push(or(ilike(tenants.name, pattern), ilike(tenants.slug, pattern), ilike(tenants.city, pattern))!);
  }
  const where = conds.length ? and(...conds) : undefined;
  const [rows, [count]] = await Promise.all([
    db
      .select({ tenant: tenants, ...countsSelect })
      .from(tenants)
      .where(where)
      .orderBy(asc(tenants.name))
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize),
    db.select({ count: sql<number>`count(*)::int` }).from(tenants).where(where),
  ]);
  return { rows, total: count?.count ?? 0 };
}

export async function tenantCounts(db: DbClient, tenantId: string): Promise<TenantCountsRow> {
  const [row] = await db.select(countsSelect).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  return row ?? { approvedMembers: 0, pendingMembers: 0, suspendedMembers: 0, activeMembers30d: 0, newMembers30d: 0, billingModel: null };
}

export async function countTenantsByStatus(db: DbClient): Promise<Record<TenantRow["status"], number>> {
  const rows = await db.select({ status: tenants.status, count: sql<number>`count(*)::int` }).from(tenants).groupBy(tenants.status);
  const out: Record<TenantRow["status"], number> = { ACTIVE: 0, SUSPENDED: 0, ARCHIVED: 0 };
  for (const r of rows) out[r.status] = r.count;
  return out;
}
