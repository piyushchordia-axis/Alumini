import { adminMembersQuerySchema, memberApproveSchema, memberReasonSchema, memberRejectSchema, memberRoleSchema, membershipIdParamsSchema, membershipProfileUpdateSchema, type AdminMemberDetailDto } from "@illuminize/shared";
import { Router } from "express";
import type { AppContext } from "../../../context";
import { toAuditDto } from "../../../dto/membership.dto";
import { byUser, rateLimit } from "../../../middleware/rateLimit";
import { ok, route } from "../../../middleware/validate";
import { listAuditForMembership } from "../../../repositories/audit.repo";
import {
  adminTransition,
  adminUpdateProfile,
  approveAllPending,
  changeRole,
  getMemberForAdmin,
  listMembers,
} from "../../../services/membership.service";
import { getMentorProfileForAdmin, removeMentorAsAdmin } from "../../../services/mentorship/mentorship.service";

export function memberRoutes(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  const actor = (req: Parameters<Parameters<typeof route>[1]>[0]["req"]) => ({ ...req.auth!, membershipId: req.membership?.id ?? null, ip: req.ip });
  // What an admin with an open chat report about them is refused, so asking for a change that changes nothing isn't a free way to find out when a report opens.
  const heldBackLimit = rateLimit(ctx, { bucket: "member-admin-action", limit: 60, windowSec: 3600, keyFn: byUser });

  router.get(
    "/members",
    route({ query: adminMembersQuerySchema }, async ({ req, res, query }) => {
      res.json(await listMembers(ctx, req.tenantCtx!.tenant.id, query));
    }),
  );

  router.post(
    "/members/approve-all-pending",
    route({}, async ({ req, res }) => {
      ok(res, await approveAllPending(ctx, req.tenantCtx!, actor(req)));
    }),
  );

  router.get(
    "/members/:membershipId",
    route({ params: membershipIdParamsSchema }, async ({ req, res, params }) => {
      const tenantId = req.tenantCtx!.tenant.id;
      const [member, audit, mentorProfile] = await Promise.all([
        getMemberForAdmin(ctx, tenantId, params.membershipId),
        listAuditForMembership(ctx.db, tenantId, params.membershipId, req.auth!.userId),
        getMentorProfileForAdmin(ctx, tenantId, params.membershipId),
      ]);
      const detail: AdminMemberDetailDto = { ...member, audit: audit.map((a) => toAuditDto(a.entry, a.actorName)), mentorProfile };
      ok(res, detail);
    }),
  );

  // Approving isn't held back, so admins can work through a queue of new members one at a time. The service refuses
  // approving an admin as it does reinstating one, but only approved members are given the role, so no admin is pending
  // or rejected.
  router.post(
    "/members/:membershipId/approve",
    route({ params: membershipIdParamsSchema, body: memberApproveSchema }, async ({ req, res, params, body }) => {
      ok(res, await adminTransition(ctx, req.tenantCtx!, actor(req), params.membershipId, "approve", undefined, body.expectedStatus));
    }),
  );

  // Reinstating a suspended admin is refused while a chat report names the actor, so it's held back like suspending.
  router.post(
    "/members/:membershipId/reinstate",
    heldBackLimit,
    route({ params: membershipIdParamsSchema }, async ({ req, res, params }) => {
      ok(res, await adminTransition(ctx, req.tenantCtx!, actor(req), params.membershipId, "reinstate"));
    }),
  );

  router.post(
    "/members/:membershipId/reject",
    route({ params: membershipIdParamsSchema, body: memberRejectSchema }, async ({ req, res, params, body }) => {
      ok(res, await adminTransition(ctx, req.tenantCtx!, actor(req), params.membershipId, "reject", body.reason, body.expectedStatus));
    }),
  );

  router.post(
    "/members/:membershipId/suspend",
    heldBackLimit,
    route({ params: membershipIdParamsSchema, body: memberReasonSchema }, async ({ req, res, params, body }) => {
      ok(res, await adminTransition(ctx, req.tenantCtx!, actor(req), params.membershipId, "suspend", body.reason));
    }),
  );

  router.patch(
    "/members/:membershipId/role",
    heldBackLimit,
    route({ params: membershipIdParamsSchema, body: memberRoleSchema }, async ({ req, res, params, body }) => {
      ok(res, await changeRole(ctx, req.tenantCtx!, actor(req), params.membershipId, body.role));
    }),
  );

  router.patch(
    "/members/:membershipId/profile",
    heldBackLimit,
    route({ params: membershipIdParamsSchema, body: membershipProfileUpdateSchema }, async ({ req, res, params, body }) => {
      ok(res, await adminUpdateProfile(ctx, req.tenantCtx!, actor(req), params.membershipId, body));
    }),
  );

  // A mentor's note is their own words on their profile, not chat, so it can't be reported: an admin takes them out of the list
  // instead. Held back like the member actions above while a chat report names the admin.
  router.post(
    "/mentors/:membershipId/remove",
    heldBackLimit,
    route({ params: membershipIdParamsSchema }, async ({ req, res, params }) => {
      ok(res, await removeMentorAsAdmin(ctx, req.tenantCtx!, actor(req), params.membershipId));
    }),
  );

  return router;
}
