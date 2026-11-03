import { chatGroupCandidatesQuerySchema, chatGroupCreateSchema, chatGroupInviteSchema, chatGroupMemberParamsSchema, chatGroupsQuerySchema, chatGroupUpdateSchema, cursorQuerySchema, idParamsSchema } from "@illuminize/shared";
import { Router } from "express";
import type { AppContext } from "../../context";
import { noStore } from "../../middleware/noStore";
import { byMembership, rateLimit } from "../../middleware/rateLimit";
import { requireChatEligible, requireFeature, requireMember } from "../../middleware/tenant";
import { noContent, ok, route } from "../../middleware/validate";
import {
  acceptInvite,
  archiveGroup,
  createGroup,
  declineInvite,
  editGroup,
  getGroup,
  inviteToGroup,
  joinGroup,
  leaveGroup,
  listGroupMembers,
  listGroups,
  listInviteCandidates,
  listMyInvites,
  removeMember,
} from "../../services/chat/groups.service";
import { contentActor } from "./_actor";

/**
 * Finding, running and joining groups. Their threads open through the conversation routes like any other. `groups` gates
 * all of it here, and each group's own kind is checked again in the service, because an invite-only group needs messaging too.
 */
export function chatGroupRoutes(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  router.use("/chat/groups", noStore, requireMember, requireChatEligible, requireFeature("groups"));

  const limit = (bucket: string, max: number, windowSec: number) => rateLimit(ctx, { bucket, limit: max, windowSec, keyFn: byMembership });
  const createLimit = limit("chat-group-create", 5, 24 * 60 * 60);
  const editLimit = limit("chat-group-edit", 30, 60 * 60);
  const memberLimit = limit("chat-group-member", 60, 60 * 60);
  const readLimit = limit("chat-read", 120, 60);

  router.get("/chat/groups", route({ query: chatGroupsQuerySchema }, async ({ req, res, query }) => res.json(await listGroups(ctx, req.tenantCtx!, contentActor(req), query))));
  router.post("/chat/groups", createLimit, route({ body: chatGroupCreateSchema }, async ({ req, res, body }) => ok(res, await createGroup(ctx, req.tenantCtx!, contentActor(req), body), 201)));
  // Before /:id, which would otherwise take "invites" for an id and refuse it.
  router.get("/chat/groups/invites", route({ query: cursorQuerySchema }, async ({ req, res, query }) => res.json(await listMyInvites(ctx, req.tenantCtx!, contentActor(req), query))));
  router.get("/chat/groups/:id", route({ params: idParamsSchema }, async ({ req, res, params }) => ok(res, await getGroup(ctx, req.tenantCtx!, contentActor(req), params.id))));
  router.patch(
    "/chat/groups/:id",
    editLimit,
    route({ params: idParamsSchema, body: chatGroupUpdateSchema }, async ({ req, res, params, body }) =>
      ok(res, body.archived ? await archiveGroup(ctx, req.tenantCtx!, contentActor(req), params.id) : await editGroup(ctx, req.tenantCtx!, contentActor(req), params.id, body)),
    ),
  );
  router.get("/chat/groups/:id/members", route({ params: idParamsSchema, query: cursorQuerySchema }, async ({ req, res, params, query }) => res.json(await listGroupMembers(ctx, req.tenantCtx!, contentActor(req), params.id, query))));
  router.get(
    "/chat/groups/:id/invite-candidates",
    readLimit,
    route({ params: idParamsSchema, query: chatGroupCandidatesQuerySchema }, async ({ req, res, params, query }) => ok(res, await listInviteCandidates(ctx, req.tenantCtx!, contentActor(req), params.id, query))),
  );
  router.post("/chat/groups/:id/join", memberLimit, route({ params: idParamsSchema }, async ({ req, res, params }) => ok(res, await joinGroup(ctx, req.tenantCtx!, contentActor(req), params.id))));
  router.post("/chat/groups/:id/leave", memberLimit, route({ params: idParamsSchema }, async ({ req, res, params }) => {
    await leaveGroup(ctx, req.tenantCtx!, contentActor(req), params.id);
    noContent(res);
  }));
  // The per-day limit counts invitees, not calls, so it's taken in the service.
  router.post("/chat/groups/:id/invites", route({ params: idParamsSchema, body: chatGroupInviteSchema }, async ({ req, res, params, body }) => ok(res, await inviteToGroup(ctx, req.tenantCtx!, contentActor(req), params.id, body.membershipIds), 201)));
  router.post("/chat/groups/:id/invites/accept", memberLimit, route({ params: idParamsSchema }, async ({ req, res, params }) => ok(res, await acceptInvite(ctx, req.tenantCtx!, contentActor(req), params.id))));
  router.post("/chat/groups/:id/invites/decline", memberLimit, route({ params: idParamsSchema }, async ({ req, res, params }) => {
    await declineInvite(ctx, req.tenantCtx!, contentActor(req), params.id);
    noContent(res);
  }));
  router.delete("/chat/groups/:id/members/:membershipId", memberLimit, route({ params: chatGroupMemberParamsSchema }, async ({ req, res, params }) => {
    await removeMember(ctx, req.tenantCtx!, contentActor(req), params.id, params.membershipId);
    noContent(res);
  }));

  return router;
}
