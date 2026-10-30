import { fundingCreateSchema, fundingListQuerySchema, fundingUpdateSchema, idParamsSchema } from "@illuminize/shared";
import { Router } from "express";
import type { AppContext } from "../../context";
import { byMembership, rateLimit } from "../../middleware/rateLimit";
import { requireFeature, requireMember } from "../../middleware/tenant";
import { noContent, ok, route } from "../../middleware/validate";
import { closeFundingListing, createFunding, getFunding, listTenantFunding, removeFundingListing, updateFundingListing } from "../../services/funding.service";
import { contentActor } from "./_actor";

export function fundingRoutes(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  router.use("/funding", requireMember, requireFeature("funding"));
  const createLimit = rateLimit(ctx, { bucket: "content-create", limit: 30, windowSec: 3600, keyFn: byMembership });

  router.get("/funding", route({ query: fundingListQuerySchema }, async ({ req, res, query }) => res.json(await listTenantFunding(ctx, req.tenantCtx!, contentActor(req), query))));
  router.post("/funding", createLimit, route({ body: fundingCreateSchema }, async ({ req, res, body }) => ok(res, await createFunding(ctx, req.tenantCtx!, contentActor(req), body), 201)));
  router.get("/funding/:id", route({ params: idParamsSchema }, async ({ req, res, params }) => ok(res, await getFunding(ctx, req.tenantCtx!, contentActor(req), params.id))));
  router.patch("/funding/:id", route({ params: idParamsSchema, body: fundingUpdateSchema }, async ({ req, res, params, body }) => ok(res, await updateFundingListing(ctx, req.tenantCtx!, contentActor(req), params.id, body))));
  router.delete("/funding/:id", route({ params: idParamsSchema }, async ({ req, res, params }) => {
    await removeFundingListing(ctx, req.tenantCtx!, contentActor(req), params.id);
    noContent(res);
  }));
  router.post("/funding/:id/close", route({ params: idParamsSchema }, async ({ req, res, params }) => ok(res, await closeFundingListing(ctx, req.tenantCtx!, contentActor(req), params.id))));
  return router;
}
