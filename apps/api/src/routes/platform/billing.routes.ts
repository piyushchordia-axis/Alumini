import { billingPlanCreateSchema, billingPlanUpdateSchema, billingUsageQuerySchema, planIdParamsSchema, snapshotCreateSchema, tenantIdParamsSchema } from "@illuminize/shared";
import { Router } from "express";
import type { AppContext } from "../../context";
import { ok, route } from "../../middleware/validate";
import { computeUsage, createBillingPlan, createSnapshot, getTenantBilling, updateBillingPlan } from "../../services/billing.service";

export function platformBillingRoutes(ctx: AppContext): Router {
  const router = Router();
  const actor = (req: { auth?: { userId: string; sid: string; isPlatformAdmin: boolean }; ip?: string }) => ({ ...req.auth!, ip: req.ip });

  router.get("/tenants/:tenantId/billing", route({ params: tenantIdParamsSchema }, async ({ res, params }) => ok(res, await getTenantBilling(ctx, params.tenantId))));
  router.post("/tenants/:tenantId/billing/plans", route({ params: tenantIdParamsSchema, body: billingPlanCreateSchema }, async ({ req, res, params, body }) => ok(res, await createBillingPlan(ctx, actor(req), params.tenantId, body), 201)));
  router.patch("/billing/plans/:planId", route({ params: planIdParamsSchema, body: billingPlanUpdateSchema }, async ({ req, res, params, body }) => ok(res, await updateBillingPlan(ctx, actor(req), params.planId, body))));
  router.get("/tenants/:tenantId/billing/usage", route({ params: tenantIdParamsSchema, query: billingUsageQuerySchema }, async ({ res, params, query }) => ok(res, await computeUsage(ctx, params.tenantId, query))));
  router.post("/tenants/:tenantId/billing/snapshots", route({ params: tenantIdParamsSchema, body: snapshotCreateSchema }, async ({ req, res, params, body }) => ok(res, await createSnapshot(ctx, actor(req), params.tenantId, body), 201)));
  return router;
}
