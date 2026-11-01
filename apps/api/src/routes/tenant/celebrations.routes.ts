import { celebrationWishSchema, membershipIdParamsSchema } from "@illuminize/shared";
import { Router } from "express";
import type { AppContext } from "../../context";
import { byMembership, rateLimit } from "../../middleware/rateLimit";
import { requireMember } from "../../middleware/tenant";
import { ok, route } from "../../middleware/validate";
import { getCelebrationsToday, sendWish } from "../../services/celebrations.service";
import { getLatestDigest } from "../../services/digest.service";

export function celebrationRoutes(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  router.use("/celebrations", requireMember);
  router.use("/digest", requireMember);
  router.get(
    "/digest/latest",
    route({}, async ({ req, res }) => {
      ok(res, await getLatestDigest(ctx, req.tenantCtx!.tenant.id));
    }),
  );
  router.get(
    "/celebrations/today",
    route({}, async ({ req, res }) => {
      ok(res, await getCelebrationsToday(ctx, req.tenantCtx!, req.membership!));
    }),
  );
  router.post(
    "/celebrations/:membershipId/wishes",
    rateLimit(ctx, { bucket: "celebration-wish", limit: 60, windowSec: 3600, keyFn: byMembership }),
    route({ params: membershipIdParamsSchema, body: celebrationWishSchema }, async ({ req, res, params, body }) => {
      ok(res, await sendWish(ctx, req.tenantCtx!, req.membership!, params.membershipId, body.kind));
    }),
  );
  return router;
}
