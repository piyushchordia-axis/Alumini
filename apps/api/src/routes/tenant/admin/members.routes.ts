import { adminMembersQuerySchema, memberReasonSchema, memberRoleSchema, membershipIdParamsSchema, membershipProfileUpdateSchema } from "@illuminize/shared";
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
      const [member, audit] = await Promise.all([
        getMemberForAdmin(ctx, tenantId, params.membershipId),
        listAuditForMembership(ctx.db, tenantId, params.membershipId, req.auth!.userId),
      ]);
      ok(res, { ...member, audit: audit.map((a) => toAuditDto(a)) });
    }),
  );

  for (const action of ["approve", "reinstate"] as const) {
    router.post(
      `/members/:membershipId/${action}`,
      route({ params: membershipIdParamsSchema }, async ({ req, res, params }) => {
        ok(res, await adminTransition(ctx, req.tenantCtx!, actor(req), params.membershipId, action));
      }),
    );
  }

  router.post(
    "/members/:membershipId/reject",
    route({ params: membershipIdParamsSchema, body: memberReasonSchema }, async ({ req, res, params, body }) => {
      ok(res, await adminTransition(ctx, req.tenantCtx!, actor(req), params.membershipId, "reject", body.reason));
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

  return router;
}
