import { attendeesQuerySchema, eventCancelSchema, eventCreateSchema, eventListQuerySchema, eventUpdateSchema, idParamsSchema, rsvpSchema } from "@illuminize/shared";
import { Router } from "express";
import type { AppContext } from "../../context";
import { byMembership, rateLimit } from "../../middleware/rateLimit";
import { requireFeature, requireMember } from "../../middleware/tenant";
import { noContent, ok, route } from "../../middleware/validate";
import { cancelEvent, clearRsvp, createEvent, getEvent, listEventAttendees, listTenantEvents, removeEvent, setRsvp, updateEventListing } from "../../services/events.service";
import { contentActor } from "./_actor";

export function eventRoutes(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  router.use("/events", requireMember, requireFeature("events"));
  const createLimit = rateLimit(ctx, { bucket: "content-create", limit: 30, windowSec: 3600, keyFn: byMembership });

  router.get("/events", route({ query: eventListQuerySchema }, async ({ req, res, query }) => res.json(await listTenantEvents(ctx, req.tenantCtx!, contentActor(req), query))));
  router.post("/events", createLimit, route({ body: eventCreateSchema }, async ({ req, res, body }) => ok(res, await createEvent(ctx, req.tenantCtx!, contentActor(req), body), 201)));
  router.get("/events/:id", route({ params: idParamsSchema }, async ({ req, res, params }) => ok(res, await getEvent(ctx, req.tenantCtx!, contentActor(req), params.id))));
  router.patch("/events/:id", route({ params: idParamsSchema, body: eventUpdateSchema }, async ({ req, res, params, body }) => ok(res, await updateEventListing(ctx, req.tenantCtx!, contentActor(req), params.id, body))));
  router.delete("/events/:id", route({ params: idParamsSchema }, async ({ req, res, params }) => {
    await removeEvent(ctx, req.tenantCtx!, contentActor(req), params.id);
    noContent(res);
  }));
  router.post("/events/:id/cancel", route({ params: idParamsSchema, body: eventCancelSchema }, async ({ req, res, params, body }) => ok(res, await cancelEvent(ctx, req.tenantCtx!, contentActor(req), params.id, body.reason))));
  router.put("/events/:id/rsvp", route({ params: idParamsSchema, body: rsvpSchema }, async ({ req, res, params, body }) => ok(res, await setRsvp(ctx, req.tenantCtx!, contentActor(req), params.id, body.status))));
  router.delete("/events/:id/rsvp", route({ params: idParamsSchema }, async ({ req, res, params }) => ok(res, await clearRsvp(ctx, req.tenantCtx!, contentActor(req), params.id))));
  router.get("/events/:id/attendees", route({ params: idParamsSchema, query: attendeesQuerySchema }, async ({ req, res, params, query }) => res.json(await listEventAttendees(ctx, req.tenantCtx!, contentActor(req), params.id, query))));
  return router;
}
