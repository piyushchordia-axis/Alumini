import type { BillingPlanCreateInput, BillingPlanDto, BillingPlanUpdateInput, BillingSnapshotDto, BillingUsageDto, BillingUsageQuery, SnapshotCreateInput } from "@illuminize/shared";
import type { AppContext } from "../context";
import { toBillingPlanDto, toBillingSnapshotDto } from "../dto/platform.dto";
import { AppError } from "../lib/errors";
import { runInTransaction } from "../lib/transaction";
import { closeOpenPlansBefore, findPlanById, findPlanEffectiveOn, insertPlan, insertSnapshot, listPlans, listSnapshots, updatePlan } from "../repositories/billing.repo";
import { billingCountsForPeriod } from "../repositories/memberships.repo";
import { findTenantById } from "../repositories/tenants.repo";
import type { AuthContext } from "../types/request";
import { recordAudit } from "./audit.service";
import { billingPeriod, currentMonth, cycleFraction, todayIn } from "./billing.periods";

interface PlatformActor extends AuthContext {
  ip?: string;
}

const today = (ctx: AppContext) => todayIn(ctx.config.BILLING_TIMEZONE);

async function assertTenant(ctx: AppContext, tenantId: string) {
  const tenant = await findTenantById(ctx.db, tenantId);
  if (!tenant) throw AppError.notFound("Institution not found", "TENANT_NOT_FOUND");
  return tenant;
}

export async function getTenantBilling(ctx: AppContext, tenantId: string): Promise<{ currentPlan: BillingPlanDto | null; plans: BillingPlanDto[]; snapshots: BillingSnapshotDto[] }> {
  await assertTenant(ctx, tenantId);
  const [current, plans, snapshots] = await Promise.all([findPlanEffectiveOn(ctx.db, tenantId, today(ctx)), listPlans(ctx.db, tenantId), listSnapshots(ctx.db, tenantId)]);
  return { currentPlan: current ? toBillingPlanDto(current) : null, plans: plans.map(toBillingPlanDto), snapshots: snapshots.map(toBillingSnapshotDto) };
}

export async function createBillingPlan(ctx: AppContext, actor: PlatformActor, tenantId: string, input: BillingPlanCreateInput): Promise<BillingPlanDto> {
  await assertTenant(ctx, tenantId);
  const row = await runInTransaction(ctx, async (tx) => {
    const closed = await closeOpenPlansBefore(tx, tenantId, input.effectiveFrom);
    const plan = await insertPlan(tx, {
      tenantId,
      billingModel: input.billingModel,
      billingCycle: input.billingCycle,
      currency: input.currency,
      pricePerActiveUserMinor: input.billingModel === "PER_ACTIVE_USER" ? (input.pricePerActiveUserMinor ?? null) : null,
      flatFeeMinor: input.billingModel === "FLAT_FEE" ? (input.flatFeeMinor ?? null) : null,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo ?? null,
      notes: input.notes ?? null,
      createdByUserId: actor.userId,
    });
    await recordAudit(
      ctx,
      {
        tenantId,
        actorUserId: actor.userId,
        action: "platform.billing.plan.create",
        targetType: "billing_plan",
        targetId: plan.id,
        metadata: { billingModel: plan.billingModel, effectiveFrom: plan.effectiveFrom, closedPlans: closed },
        ip: actor.ip,
      },
      tx,
    );
    return plan;
  });
  return toBillingPlanDto(row);
}

export async function updateBillingPlan(ctx: AppContext, actor: PlatformActor, planId: string, input: BillingPlanUpdateInput): Promise<BillingPlanDto> {
  const plan = await findPlanById(ctx.db, planId);
  if (!plan) throw AppError.notFound("Billing plan not found");
  if (input.effectiveTo && input.effectiveTo < plan.effectiveFrom) throw AppError.badRequest("effectiveTo must be on or after effectiveFrom", [{ path: "effectiveTo", message: "Must be on or after the start date" }]);
  // A partial update must leave the plan consistent with its model (a per-user plan needs its price).
  const merged = { ...plan, ...input };
  if (plan.billingModel === "PER_ACTIVE_USER" && merged.pricePerActiveUserMinor == null) throw AppError.badRequest("A per-active-user plan needs a price per user", [{ path: "pricePerActiveUserMinor", message: "Required for this plan" }]);
  if (plan.billingModel === "FLAT_FEE" && merged.flatFeeMinor == null) throw AppError.badRequest("A flat-fee plan needs a fee", [{ path: "flatFeeMinor", message: "Required for this plan" }]);
  const row = (await updatePlan(ctx.db, planId, {
    ...(input.billingCycle !== undefined ? { billingCycle: input.billingCycle } : {}),
    ...(input.currency !== undefined ? { currency: input.currency } : {}),
    ...(input.pricePerActiveUserMinor !== undefined ? { pricePerActiveUserMinor: input.pricePerActiveUserMinor } : {}),
    ...(input.flatFeeMinor !== undefined ? { flatFeeMinor: input.flatFeeMinor } : {}),
    ...(input.effectiveTo !== undefined ? { effectiveTo: input.effectiveTo } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
  }))!;
  await recordAudit(ctx, {
    tenantId: plan.tenantId,
    actorUserId: actor.userId,
    action: "platform.billing.plan.update",
    targetType: "billing_plan",
    targetId: planId,
    metadata: { fields: Object.keys(input) },
    ip: actor.ip,
  });
  return toBillingPlanDto(row);
}

/** Estimated charge for the period: the plan's per-cycle price, prorated to the period's length. */
function estimateAmount(plan: BillingPlanDto | null, activeMembers: number, fraction: number): number {
  if (!plan) return 0;
  switch (plan.billingModel) {
    case "PER_ACTIVE_USER":
      return Math.round((plan.pricePerActiveUserMinor ?? 0) * activeMembers * fraction);
    case "FLAT_FEE":
      return Math.round((plan.flatFeeMinor ?? 0) * fraction);
    case "FREE":
      return 0;
  }
}

/**
 * Usage for a period of calendar days in the billing time zone (default: the current month). Counts are as of the
 * period end, so re-running a past period later gives the same numbers.
 */
export async function computeUsage(ctx: AppContext, tenantId: string, query: BillingUsageQuery): Promise<BillingUsageDto> {
  await assertTenant(ctx, tenantId);
  const timeZone = ctx.config.BILLING_TIMEZONE;
  const month = currentMonth(timeZone);
  const periodStart = query.from ?? month.fromDay;
  const periodEnd = query.to ?? month.toDay;
  const period = billingPeriod(periodStart, periodEnd, timeZone);
  const [counts, planRow] = await Promise.all([billingCountsForPeriod(ctx.db, tenantId, period), findPlanEffectiveOn(ctx.db, tenantId, periodEnd)]);
  const plan = planRow ? toBillingPlanDto(planRow) : null;
  const fraction = plan ? cycleFraction(periodStart, periodEnd, plan.billingCycle) : 1;
  return {
    periodStart,
    periodEnd,
    timeZone,
    approvedMembers: counts.approved,
    activeMembers: counts.active,
    newMembers: counts.created,
    plan,
    cycleFraction: Math.round(fraction * 10_000) / 10_000,
    estimatedAmountMinor: estimateAmount(plan, counts.active, fraction),
    currency: plan?.currency ?? "INR",
  };
}

export async function createSnapshot(ctx: AppContext, actor: PlatformActor, tenantId: string, input: SnapshotCreateInput): Promise<BillingSnapshotDto> {
  const usage = await computeUsage(ctx, tenantId, { from: input.periodStart, to: input.periodEnd });
  const row = await insertSnapshot(ctx.db, {
    tenantId,
    billingPlanId: usage.plan?.id ?? null,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    approvedMemberCount: usage.approvedMembers,
    activeMemberCount: usage.activeMembers,
    newMemberCount: usage.newMembers,
    amountMinor: usage.estimatedAmountMinor,
    currency: usage.currency,
    notes: input.notes ?? null,
    createdByUserId: actor.userId,
  });
  if (!row) throw AppError.conflict("A snapshot for this period already exists");
  await recordAudit(ctx, {
    tenantId,
    actorUserId: actor.userId,
    action: "platform.billing.snapshot.create",
    targetType: "billing_snapshot",
    targetId: row.id,
    metadata: { periodStart: input.periodStart, periodEnd: input.periodEnd, amountMinor: row.amountMinor },
    ip: actor.ip,
  });
  return toBillingSnapshotDto(row);
}
