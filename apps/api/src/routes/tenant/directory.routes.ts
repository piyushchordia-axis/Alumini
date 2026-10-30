import { directoryQuerySchema, membershipIdParamsSchema } from "@illuminize/shared";
import { Router } from "express";
import type { AppContext } from "../../context";
import { requireFeature, requireMember } from "../../middleware/tenant";
import { ok, route } from "../../middleware/validate";
import { getDirectoryFilters, getMemberProfile, searchMembers } from "../../services/directory.service";

export function directoryRoutes(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  router.use("/directory", requireMember, requireFeature("directory"));

  router.get(
    "/directory",
    route({ query: directoryQuerySchema }, async ({ req, res, query }) => {
      res.json(await searchMembers(ctx, req.tenantCtx!.tenant.id, query));
    }),
  );
  router.get(
    "/directory/filters",
    route({}, async ({ req, res }) => {
      ok(res, await getDirectoryFilters(ctx, req.tenantCtx!.tenant.id));
    }),
  );
  router.get(
    "/directory/:membershipId",
    route({ params: membershipIdParamsSchema }, async ({ req, res, params }) => {
      ok(res, await getMemberProfile(ctx, req.tenantCtx!.tenant.id, params.membershipId));
    }),
  );
  return router;
}
