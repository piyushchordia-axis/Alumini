import { invitationIdParamsSchema, invitationImportSchema, invitationSendSchema, invitationsQuerySchema } from "@illuminize/shared";
import { Router } from "express";
import type { AppContext } from "../../../context";
import { byMembership, rateLimit } from "../../../middleware/rateLimit";
import { ok, route } from "../../../middleware/validate";
import { importInvitations, invitationSummary, listInvitations, revokeInvitation, sendInvitations, sendPendingInvitations } from "../../../services/invitations.service";
import { adminActor } from "../_actor";

export function invitationRoutes(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  const importLimit = rateLimit(ctx, { bucket: "invite-import", limit: 120, windowSec: 3600, keyFn: byMembership });

  router.get(
    "/invitations",
    route({ query: invitationsQuerySchema }, async ({ req, res, query }) => {
      res.json(await listInvitations(ctx, req.tenantCtx!.tenant.id, query));
    }),
  );
  router.get(
    "/invitations/summary",
    route({}, async ({ req, res }) => {
      ok(res, await invitationSummary(ctx, req.tenantCtx!.tenant.id));
    }),
  );
  router.post(
    "/invitations/import",
    importLimit,
    route({ body: invitationImportSchema }, async ({ req, res, body }) => {
      ok(res, await importInvitations(ctx, req.tenantCtx!, adminActor(req), body));
    }),
  );
  router.post(
    "/invitations/send",
    route({ body: invitationSendSchema }, async ({ req, res, body }) => {
      ok(res, await sendInvitations(ctx, req.tenantCtx!, adminActor(req), body.ids));
    }),
  );
  router.post(
    "/invitations/send-pending",
    route({}, async ({ req, res }) => {
      ok(res, await sendPendingInvitations(ctx, req.tenantCtx!, adminActor(req)));
    }),
  );
  router.post(
    "/invitations/:invitationId/revoke",
    route({ params: invitationIdParamsSchema }, async ({ req, res, params }) => {
      ok(res, await revokeInvitation(ctx, req.tenantCtx!, adminActor(req), params.invitationId));
    }),
  );
  return router;
}
