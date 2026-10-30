import { and, desc, eq, isNull, lte, or, sql } from "drizzle-orm";
import type { DbClient } from "../db/client";
import { tenantBillingPlans, tenantBillingSnapshots } from "../db/schema";

export type BillingPlanRow = typeof tenantBillingPlans.$inferSelect;
export type BillingPlanInsert = typeof tenantBillingPlans.$inferInsert;
export type BillingSnapshotRow = typeof tenantBillingSnapshots.$inferSelect;
export type BillingSnapshotInsert = typeof tenantBillingSnapshots.$inferInsert;

export async function listPlans(db: DbClient, tenantId: string): Promise<BillingPlanRow[]> {
  return db.select().from(tenantBillingPlans).where(eq(tenantBillingPlans.tenantId, tenantId)).orderBy(desc(tenantBillingPlans.effectiveFrom));
}

export async function findPlanById(db: DbClient, planId: string): Promise<BillingPlanRow | undefined> {
  const [row] = await db.select().from(tenantBillingPlans).where(eq(tenantBillingPlans.id, planId)).limit(1);
  return row;
}

/** The plan in force on `onDate` (YYYY-MM-DD). */
export async function findPlanEffectiveOn(db: DbClient, tenantId: string, onDate: string): Promise<BillingPlanRow | undefined> {
  const [row] = await db
    .select()
    .from(tenantBillingPlans)
    .where(
      and(
        eq(tenantBillingPlans.tenantId, tenantId),
        lte(tenantBillingPlans.effectiveFrom, onDate),
        or(isNull(tenantBillingPlans.effectiveTo), sql`${tenantBillingPlans.effectiveTo} >= ${onDate}`),
      ),
    )
    .orderBy(desc(tenantBillingPlans.effectiveFrom))
    .limit(1);
  return row;
}

export async function insertPlan(db: DbClient, values: BillingPlanInsert): Promise<BillingPlanRow> {
  const [row] = await db.insert(tenantBillingPlans).values(values).returning();
  return row!;
}

export async function updatePlan(db: DbClient, planId: string, values: Partial<BillingPlanInsert>): Promise<BillingPlanRow | undefined> {
  const [row] = await db
    .update(tenantBillingPlans)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(tenantBillingPlans.id, planId))
    .returning();
  return row;
}

/** Closes every still-open plan that started before `newEffectiveFrom` so only one plan is in force at a time. */
export async function closeOpenPlansBefore(db: DbClient, tenantId: string, newEffectiveFrom: string): Promise<number> {
  const rows = await db
    .update(tenantBillingPlans)
    .set({ effectiveTo: sql`(${newEffectiveFrom}::date - interval '1 day')::date`, updatedAt: new Date() })
    .where(
      and(
        eq(tenantBillingPlans.tenantId, tenantId),
        sql`${tenantBillingPlans.effectiveFrom} < ${newEffectiveFrom}`,
        or(isNull(tenantBillingPlans.effectiveTo), sql`${tenantBillingPlans.effectiveTo} >= ${newEffectiveFrom}`),
      ),
    )
    .returning({ id: tenantBillingPlans.id });
  return rows.length;
}

export async function listSnapshots(db: DbClient, tenantId: string): Promise<BillingSnapshotRow[]> {
  return db.select().from(tenantBillingSnapshots).where(eq(tenantBillingSnapshots.tenantId, tenantId)).orderBy(desc(tenantBillingSnapshots.periodStart));
}

export async function insertSnapshot(db: DbClient, values: BillingSnapshotInsert): Promise<BillingSnapshotRow | undefined> {
  const [row] = await db.insert(tenantBillingSnapshots).values(values).onConflictDoNothing().returning();
  return row;
}
