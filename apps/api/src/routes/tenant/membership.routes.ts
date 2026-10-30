import { membershipProfileSchema, membershipProfileUpdateSchema } from "@illuminize/shared";
import { Router } from "express";
import type { AppContext } from "../../context";
import { toMembershipDto } from "../../dto/membership.dto";
import { AppError } from "../../lib/errors";
import { requireMember } from "../../middleware/tenant";
import { ok, route } from "../../middleware/validate";
import { registerMembership, updateMyProfile } from "../../services/membership.service";

export function membershipRoutes(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });

  router.post(
    "/memberships",
    route({ body: membershipProfileSchema }, async ({ req, res, body }) => {
      const dto = await registerMembership(ctx, req.tenantCtx!, { ...req.auth!, ip: req.ip }, body);
      ok(res, dto, 201);
    }),
  );

  router.get(
    "/memberships/me",
    route({}, async ({ req, res }) => {
      if (!req.membership) throw AppError.notFound("You are not a member of this institution", "NOT_A_MEMBER");
      ok(res, toMembershipDto(req.membership));
    }),
  );

  router.patch(
    "/memberships/me",
    requireMember,
    route({ body: membershipProfileUpdateSchema }, async ({ req, res, body }) => {
      ok(res, await updateMyProfile(ctx, req.tenantCtx!, req.membership!, body));
    }),
  );

  return router;
}
