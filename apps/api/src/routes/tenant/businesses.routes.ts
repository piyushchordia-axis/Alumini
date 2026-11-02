import { businessCreateSchema, businessListQuerySchema, businessUpdateSchema, idParamsSchema } from "@illuminize/shared";
import { Router } from "express";
import type { AppContext } from "../../context";
import { byMembership, rateLimit } from "../../middleware/rateLimit";
import { requireFeature, requireMember } from "../../middleware/tenant";
import { noContent, ok, route } from "../../middleware/validate";
import { createBusiness, getBusiness, listTenantBusinesses, removeBusinessListing, updateBusinessListing } from "../../services/businesses.service";
import { contentActor } from "./_actor";

export function businessRoutes(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  router.use("/businesses", requireMember, requireFeature("businesses"));
  const createLimit = rateLimit(ctx, { bucket: "business-create", limit: 10, windowSec: 3600, keyFn: byMembership });
  // An edit under admin approval notifies every admin, so edits are limited too.
  const editLimit = rateLimit(ctx, { bucket: "business-edit", limit: 30, windowSec: 3600, keyFn: byMembership });

  router.get("/businesses", route({ query: businessListQuerySchema }, async ({ req, res, query }) => res.json(await listTenantBusinesses(ctx, req.tenantCtx!, contentActor(req), query))));
  router.post("/businesses", createLimit, route({ body: businessCreateSchema }, async ({ req, res, body }) => ok(res, await createBusiness(ctx, req.tenantCtx!, contentActor(req), body), 201)));
  router.get("/businesses/:id", route({ params: idParamsSchema }, async ({ req, res, params }) => ok(res, await getBusiness(ctx, req.tenantCtx!, contentActor(req), params.id))));
  router.patch("/businesses/:id", editLimit, route({ params: idParamsSchema, body: businessUpdateSchema }, async ({ req, res, params, body }) => ok(res, await updateBusinessListing(ctx, req.tenantCtx!, contentActor(req), params.id, body))));
  router.delete("/businesses/:id", route({ params: idParamsSchema }, async ({ req, res, params }) => {
    await removeBusinessListing(ctx, req.tenantCtx!, contentActor(req), params.id);
    noContent(res);
  }));
  return router;
}
