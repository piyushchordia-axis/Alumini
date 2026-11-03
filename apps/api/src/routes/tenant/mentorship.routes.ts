import { chatReportCreateSchema, idParamsSchema, membershipIdParamsSchema, mentorProfileUpsertSchema, mentorsQuerySchema, mentorshipRequestCreateSchema, mentorshipRequestsQuerySchema } from "@illuminize/shared";
import { Router } from "express";
import type { AppContext } from "../../context";
import { noStore } from "../../middleware/noStore";
import { byMembership, rateLimit } from "../../middleware/rateLimit";
import { requireChatEligible, requireFeature, requireMember } from "../../middleware/tenant";
import { noContent, ok, route } from "../../middleware/validate";
import {
  acceptMentorship,
  declineMentorship,
  endMentorship,
  findMentors,
  getMentor,
  getMentorshipSummary,
  getMyMentorProfile,
  listMyMentorships,
  reportMentorshipRequest,
  requestMentorship,
  saveMyMentorProfile,
  stopMentoring,
  withdrawMentorship,
} from "../../services/mentorship/mentorship.service";
import { contentActor } from "./_actor";

/**
 * Mentors and mentorship requests. Finding mentors, offering to mentor, asking and answering need `mentorship` (and so
 * messaging) and a member who isn't a current pupil. The ways out don't, so nobody is ever stuck in a connection: reading
 * their own requests, profile and summary, withdrawing, ending, reporting and stopping mentoring.
 */
export function mentorshipRoutes(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  router.use("/mentorship", noStore, requireMember);
  const gate = [requireFeature("mentorship"), requireChatEligible];

  const limit = (bucket: string, max: number, windowSec: number) => rateLimit(ctx, { bucket, limit: max, windowSec, keyFn: byMembership });
  const profileLimit = limit("mentor-profile", 30, 3600);
  const requestLimit = limit("mentorship-request", 10, 3600);
  const actionLimit = limit("connection-action", 60, 3600);
  const reportLimit = limit("chat-report", 30, 3600);

  router.get("/mentorship/me", route({}, async ({ req, res }) => ok(res, await getMyMentorProfile(ctx, req.tenantCtx!, contentActor(req)))));
  // Outside the gate: while a member can't use mentorship, this is how the apps know they still have something to leave there.
  router.get("/mentorship/summary", route({}, async ({ req, res }) => ok(res, await getMentorshipSummary(ctx, req.tenantCtx!, contentActor(req)))));
  router.put("/mentorship/me", gate, profileLimit, route({ body: mentorProfileUpsertSchema }, async ({ req, res, body }) => ok(res, await saveMyMentorProfile(ctx, req.tenantCtx!, contentActor(req), body))));
  router.delete("/mentorship/me", profileLimit, route({}, async ({ req, res }) => {
    await stopMentoring(ctx, req.tenantCtx!, contentActor(req));
    noContent(res);
  }));

  router.get("/mentorship/mentors", gate, route({ query: mentorsQuerySchema }, async ({ req, res, query }) => res.json(await findMentors(ctx, req.tenantCtx!, contentActor(req), query))));
  router.get("/mentorship/mentors/:membershipId", gate, route({ params: membershipIdParamsSchema }, async ({ req, res, params }) => ok(res, await getMentor(ctx, req.tenantCtx!, contentActor(req), params.membershipId))));

  router.post("/mentorship/requests", gate, requestLimit, route({ body: mentorshipRequestCreateSchema }, async ({ req, res, body }) => ok(res, await requestMentorship(ctx, req.tenantCtx!, contentActor(req), body), 201)));
  router.get("/mentorship/requests", route({ query: mentorshipRequestsQuerySchema }, async ({ req, res, query }) => res.json(await listMyMentorships(ctx, req.tenantCtx!, contentActor(req), query))));
  router.post("/mentorship/requests/:id/accept", gate, actionLimit, route({ params: idParamsSchema }, async ({ req, res, params }) => ok(res, await acceptMentorship(ctx, req.tenantCtx!, contentActor(req), params.id))));
  router.post("/mentorship/requests/:id/decline", gate, actionLimit, route({ params: idParamsSchema }, async ({ req, res, params }) => ok(res, await declineMentorship(ctx, req.tenantCtx!, contentActor(req), params.id))));
  router.post("/mentorship/requests/:id/withdraw", actionLimit, route({ params: idParamsSchema }, async ({ req, res, params }) => ok(res, await withdrawMentorship(ctx, req.tenantCtx!, contentActor(req), params.id))));
  router.post("/mentorship/requests/:id/end", actionLimit, route({ params: idParamsSchema }, async ({ req, res, params }) => ok(res, await endMentorship(ctx, req.tenantCtx!, contentActor(req), params.id))));
  router.post(
    "/mentorship/requests/:id/report",
    reportLimit,
    route({ params: idParamsSchema, body: chatReportCreateSchema }, async ({ req, res, params, body }) => ok(res, await reportMentorshipRequest(ctx, req.tenantCtx!, contentActor(req), params.id, body))),
  );

  return router;
}
