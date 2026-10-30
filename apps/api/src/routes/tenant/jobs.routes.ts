import { cursorQuerySchema, idParamsSchema, jobCreateSchema, jobListQuerySchema, jobSeekerUpsertSchema, jobUpdateSchema } from "@illuminize/shared";
import { Router } from "express";
import type { AppContext } from "../../context";
import { byMembership, rateLimit } from "../../middleware/rateLimit";
import { requireFeature, requireMember } from "../../middleware/tenant";
import { noContent, ok, route } from "../../middleware/validate";
import {
  closeJobListing,
  createJob,
  deleteMySeekerProfile,
  getJob,
  getMySeekerProfile,
  listJobSeekers,
  listTenantJobs,
  removeJobListing,
  updateJobListing,
  upsertMySeekerProfile,
} from "../../services/jobs.service";
import { contentActor } from "./_actor";

export function jobRoutes(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  router.use("/jobs", requireMember, requireFeature("jobs"));
  const createLimit = rateLimit(ctx, { bucket: "content-create", limit: 30, windowSec: 3600, keyFn: byMembership });

  router.get("/jobs", route({ query: jobListQuerySchema }, async ({ req, res, query }) => res.json(await listTenantJobs(ctx, req.tenantCtx!, contentActor(req), query))));
  router.post("/jobs", createLimit, route({ body: jobCreateSchema }, async ({ req, res, body }) => ok(res, await createJob(ctx, req.tenantCtx!, contentActor(req), body), 201)));

  // seekers (declared before /jobs/:id so "seekers" is not parsed as an id)
  router.get("/jobs/seekers", route({ query: cursorQuerySchema }, async ({ req, res, query }) => res.json(await listJobSeekers(ctx, req.tenantCtx!.tenant.id, query))));
  router.get("/jobs/seekers/me", route({}, async ({ req, res }) => ok(res, await getMySeekerProfile(ctx, req.tenantCtx!.tenant.id, contentActor(req)))));
  router.put("/jobs/seekers/me", route({ body: jobSeekerUpsertSchema }, async ({ req, res, body }) => ok(res, await upsertMySeekerProfile(ctx, req.tenantCtx!.tenant.id, contentActor(req), body))));
  router.delete("/jobs/seekers/me", route({}, async ({ req, res }) => {
    await deleteMySeekerProfile(ctx, req.tenantCtx!.tenant.id, contentActor(req));
    noContent(res);
  }));

  router.get("/jobs/:id", route({ params: idParamsSchema }, async ({ req, res, params }) => ok(res, await getJob(ctx, req.tenantCtx!, contentActor(req), params.id))));
  router.patch("/jobs/:id", route({ params: idParamsSchema, body: jobUpdateSchema }, async ({ req, res, params, body }) => ok(res, await updateJobListing(ctx, req.tenantCtx!, contentActor(req), params.id, body))));
  router.delete("/jobs/:id", route({ params: idParamsSchema }, async ({ req, res, params }) => {
    await removeJobListing(ctx, req.tenantCtx!, contentActor(req), params.id);
    noContent(res);
  }));
  router.post("/jobs/:id/close", route({ params: idParamsSchema }, async ({ req, res, params }) => ok(res, await closeJobListing(ctx, req.tenantCtx!, contentActor(req), params.id))));
  return router;
}
