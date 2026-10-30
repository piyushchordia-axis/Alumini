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
