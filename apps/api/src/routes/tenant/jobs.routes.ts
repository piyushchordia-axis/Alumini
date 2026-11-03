import { chatReportCreateSchema, cursorQuerySchema, idParamsSchema, jobCreateSchema, jobListQuerySchema, jobSeekerUpsertSchema, jobUpdateSchema, referralRequestCreateSchema, referralRequestsQuerySchema } from "@illuminize/shared";
import { Router } from "express";
import type { AppContext } from "../../context";
import { noStore } from "../../middleware/noStore";
import { byMembership, rateLimit } from "../../middleware/rateLimit";
import { requireChatEligible, requireFeature, requireMember } from "../../middleware/tenant";
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
import {
  acceptReferral,
  declineReferral,
  getReferralSummary,
  listJobReferrals,
  listMyReferrals,
  reportReferralRequest,
  requestReferral,
  withdrawReferral,
} from "../../services/referrals/referrals.service";
import { contentActor } from "./_actor";

/**
 * Jobs, and the referral requests that live inside them, which have no feature key of their own. Everything here needs
 * `jobs`. Asking for a referral and accepting one also need messaging, because accepting opens a private chat, and a member
 * who isn't a current pupil. The ways out don't, so nobody is stuck with a request while messaging is off: reading their own
 * lists and summary, a job's requests for its poster, withdrawing, declining and reporting.
 */
export function jobRoutes(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  router.use("/jobs", requireMember, requireFeature("jobs"));
  router.use("/jobs/referrals", noStore);
  const createLimit = rateLimit(ctx, { bucket: "content-create", limit: 30, windowSec: 3600, keyFn: byMembership });
  const referralGate = [requireFeature("messaging"), requireChatEligible];
  const limit = (bucket: string, max: number) => rateLimit(ctx, { bucket, limit: max, windowSec: 3600, keyFn: byMembership });
  const requestLimit = limit("referral-request", 10);
  const actionLimit = limit("connection-action", 60);
  const reportLimit = limit("chat-report", 30);

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

  // referral requests (also before /jobs/:id)
  router.get("/jobs/referrals/mine", route({ query: referralRequestsQuerySchema }, async ({ req, res, query }) => res.json(await listMyReferrals(ctx, req.tenantCtx!, contentActor(req), query))));
  router.get("/jobs/referrals/summary", route({}, async ({ req, res }) => ok(res, await getReferralSummary(ctx, req.tenantCtx!, contentActor(req)))));
  router.post("/jobs/referrals/:id/accept", referralGate, actionLimit, route({ params: idParamsSchema }, async ({ req, res, params }) => ok(res, await acceptReferral(ctx, req.tenantCtx!, contentActor(req), params.id))));
  router.post("/jobs/referrals/:id/decline", actionLimit, route({ params: idParamsSchema }, async ({ req, res, params }) => ok(res, await declineReferral(ctx, req.tenantCtx!, contentActor(req), params.id))));
  router.post("/jobs/referrals/:id/withdraw", actionLimit, route({ params: idParamsSchema }, async ({ req, res, params }) => ok(res, await withdrawReferral(ctx, req.tenantCtx!, contentActor(req), params.id))));
  router.post(
    "/jobs/referrals/:id/report",
    reportLimit,
    route({ params: idParamsSchema, body: chatReportCreateSchema }, async ({ req, res, params, body }) => ok(res, await reportReferralRequest(ctx, req.tenantCtx!, contentActor(req), params.id, body))),
  );

  // What a job's page holds about referrals is the viewer's own, so none of it is cached.
  router.get("/jobs/:id", noStore, route({ params: idParamsSchema }, async ({ req, res, params }) => ok(res, await getJob(ctx, req.tenantCtx!, contentActor(req), params.id))));
  router.patch("/jobs/:id", route({ params: idParamsSchema, body: jobUpdateSchema }, async ({ req, res, params, body }) => ok(res, await updateJobListing(ctx, req.tenantCtx!, contentActor(req), params.id, body))));
  router.delete("/jobs/:id", route({ params: idParamsSchema }, async ({ req, res, params }) => {
    await removeJobListing(ctx, req.tenantCtx!, contentActor(req), params.id);
    noContent(res);
  }));
  router.post("/jobs/:id/close", route({ params: idParamsSchema }, async ({ req, res, params }) => ok(res, await closeJobListing(ctx, req.tenantCtx!, contentActor(req), params.id))));
  router.post(
    "/jobs/:id/referrals",
    noStore,
    referralGate,
    requestLimit,
    route({ params: idParamsSchema, body: referralRequestCreateSchema }, async ({ req, res, params, body }) => ok(res, await requestReferral(ctx, req.tenantCtx!, contentActor(req), params.id, body), 201)),
  );
  router.get("/jobs/:id/referrals", noStore, route({ params: idParamsSchema, query: cursorQuerySchema }, async ({ req, res, params, query }) => res.json(await listJobReferrals(ctx, req.tenantCtx!, contentActor(req), params.id, query))));
  return router;
}
