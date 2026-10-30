import { tenantListQuerySchema, tenantSlugParamsSchema } from "@illuminize/shared";
import { Router } from "express";
import type { AppContext } from "../context";
import { ok, route } from "../middleware/validate";
import { getPublicTenant, listPublicTenants } from "../services/tenant.service";

export function publicRoutes(ctx: AppContext): Router {
  const router = Router();

  router.get(
    "/tenants",
    route({ query: tenantListQuerySchema }, async ({ res, query }) => {
      ok(res, await listPublicTenants(ctx, query.q));
    }),
  );

  router.get(
    "/tenants/:slug",
    route({ params: tenantSlugParamsSchema }, async ({ res, params }) => {
      ok(res, await getPublicTenant(ctx, params.slug));
    }),
  );

  return router;
}
