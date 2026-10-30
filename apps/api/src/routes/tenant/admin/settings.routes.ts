import { tenantBrandingUpdateSchema, tenantSettingsUpdateSchema } from "@illuminize/shared";
import { Router } from "express";
import type { AppContext } from "../../../context";
import { ok, route } from "../../../middleware/validate";
import { getTenantSettings, updateTenantBranding, updateTenantSettings } from "../../../services/settings.service";
import { adminActor } from "../_actor";

export function settingsRoutes(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  router.get("/settings", route({}, async ({ req, res }) => ok(res, await getTenantSettings(ctx, req.tenantCtx!))));
  router.patch("/settings", route({ body: tenantSettingsUpdateSchema }, async ({ req, res, body }) => ok(res, await updateTenantSettings(ctx, req.tenantCtx!, adminActor(req), body))));
  router.patch("/branding", route({ body: tenantBrandingUpdateSchema }, async ({ req, res, body }) => ok(res, await updateTenantBranding(ctx, req.tenantCtx!, adminActor(req), body))));
  return router;
}
