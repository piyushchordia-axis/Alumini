import { membershipProfileSchema, membershipProfileUpdateSchema } from "@illuminize/shared";
import { Router } from "express";
import type { AppContext } from "../../context";
import { AppError } from "../../lib/errors";
import { requireMember } from "../../middleware/tenant";
import { ok, route } from "../../middleware/validate";
import { getMyMembership, registerMembership, updateMyProfile } from "../../services/membership.service";
import { getFieldsForMember } from "../../services/profileFields.service";
import { findMyInvitation } from "../../services/invitations.service";

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
      ok(res, await getMyMembership(ctx, req.membership));
    }),
  );

  // Signed-in, membership not needed: an invitation for my verified phone prefills registration.
  router.get(
    "/memberships/invitation",
    route({}, async ({ req, res }) => {
      ok(res, await findMyInvitation(ctx, req.tenantCtx!, req.auth!.userId));
    }),
  );

  // Signed-in, membership not needed: the registration form shows these questions.
  router.get(
    "/profile-fields",
    route({}, async ({ req, res }) => {
      ok(res, await getFieldsForMember(ctx, req.tenantCtx!.tenant.id));
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
