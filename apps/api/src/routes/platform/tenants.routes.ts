import {
  assignAdminSchema,
  platformTenantCreateSchema,
  platformTenantUpdateSchema,
  platformTenantsQuerySchema,
  tenantAdminParamsSchema,
  tenantIdParamsSchema,
  tenantSettingsUpdateSchema,
} from "@illuminize/shared";
import { Router } from "express";
import type { AppContext } from "../../context";
import { noContent, ok, route } from "../../middleware/validate";
import {
  assignTenantAdmin,
  createPlatformTenant,
  getPlatformTenant,
  listPlatformTenantAdmins,
  listPlatformTenants,
  removeTenantAdmin,
  updatePlatformTenant,
  updatePlatformTenantSettings,
} from "../../services/platform.service";

export function platformTenantRoutes(ctx: AppContext): Router {
  const router = Router();
  const actor = (req: { auth?: { userId: string; sid: string; isPlatformAdmin: boolean }; ip?: string }) => ({ ...req.auth!, ip: req.ip });

  router.get("/tenants", route({ query: platformTenantsQuerySchema }, async ({ res, query }) => res.json(await listPlatformTenants(ctx, query))));
  router.post("/tenants", route({ body: platformTenantCreateSchema }, async ({ req, res, body }) => ok(res, await createPlatformTenant(ctx, actor(req), body), 201)));
  router.get("/tenants/:tenantId", route({ params: tenantIdParamsSchema }, async ({ res, params }) => ok(res, await getPlatformTenant(ctx, params.tenantId))));
  router.patch("/tenants/:tenantId", route({ params: tenantIdParamsSchema, body: platformTenantUpdateSchema }, async ({ req, res, params, body }) => ok(res, await updatePlatformTenant(ctx, actor(req), params.tenantId, body))));
  router.patch("/tenants/:tenantId/settings", route({ params: tenantIdParamsSchema, body: tenantSettingsUpdateSchema }, async ({ req, res, params, body }) => ok(res, await updatePlatformTenantSettings(ctx, actor(req), params.tenantId, body))));
  router.get("/tenants/:tenantId/admins", route({ params: tenantIdParamsSchema }, async ({ res, params }) => ok(res, await listPlatformTenantAdmins(ctx, params.tenantId))));
  router.post("/tenants/:tenantId/admins", route({ params: tenantIdParamsSchema, body: assignAdminSchema }, async ({ req, res, params, body }) => ok(res, await assignTenantAdmin(ctx, actor(req), params.tenantId, body), 201)));
  router.delete("/tenants/:tenantId/admins/:membershipId", route({ params: tenantAdminParamsSchema }, async ({ req, res, params }) => {
    await removeTenantAdmin(ctx, actor(req), params.tenantId, params.membershipId);
    noContent(res);
  }));
  return router;
}
