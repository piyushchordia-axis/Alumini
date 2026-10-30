import { adminMembersQuerySchema, memberReasonSchema, memberRoleSchema, membershipIdParamsSchema, membershipProfileUpdateSchema } from "@illuminize/shared";
import { Router } from "express";
import type { AppContext } from "../../../context";
import { toAuditDto } from "../../../dto/membership.dto";
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
        listAuditForMembership(ctx.db, tenantId, params.membershipId),
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

  for (const action of ["reject", "suspend"] as const) {
    router.post(
      `/members/:membershipId/${action}`,
      route({ params: membershipIdParamsSchema, body: memberReasonSchema }, async ({ req, res, params, body }) => {
        ok(res, await adminTransition(ctx, req.tenantCtx!, actor(req), params.membershipId, action, body.reason));
      }),
    );
  }

  router.patch(
    "/members/:membershipId/role",
    route({ params: membershipIdParamsSchema, body: memberRoleSchema }, async ({ req, res, params, body }) => {
      ok(res, await changeRole(ctx, req.tenantCtx!, actor(req), params.membershipId, body.role));
    }),
  );

  router.patch(
    "/members/:membershipId/profile",
    route({ params: membershipIdParamsSchema, body: membershipProfileUpdateSchema }, async ({ req, res, params, body }) => {
      ok(res, await adminUpdateProfile(ctx, req.tenantCtx!, actor(req), params.membershipId, body));
    }),
  );

  return router;
}
