import { tenantListQuerySchema, tenantSlugParamsSchema, unsubscribeQuerySchema } from "@illuminize/shared";
import { Router } from "express";
import type { AppContext } from "../context";
import { byIp, rateLimit } from "../middleware/rateLimit";
import { ok, route } from "../middleware/validate";
import { getUnsubscribeInfo, unsubscribe } from "../services/notifications/prefs.service";
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

  // Unsubscribe links from emails: no sign-in (the signed token is the authority). The POST is also the RFC 8058
  // one-click endpoint that mail apps call from the List-Unsubscribe-Post header (form body, ignored).
  const unsubscribeLimit = rateLimit(ctx, { bucket: "unsubscribe-ip", limit: 60, windowSec: 900, keyFn: byIp });
  router.get(
    "/unsubscribe",
    unsubscribeLimit,
    route({ query: unsubscribeQuerySchema }, async ({ res, query }) => {
      ok(res, await getUnsubscribeInfo(ctx, query.token));
    }),
  );
  router.post(
    "/unsubscribe",
    unsubscribeLimit,
    route({ query: unsubscribeQuerySchema }, async ({ req, res, query }) => {
      ok(res, await unsubscribe(ctx, query.token, req.ip));
    }),
  );

  return router;
}
