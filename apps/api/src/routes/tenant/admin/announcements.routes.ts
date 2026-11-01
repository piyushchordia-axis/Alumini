import { Router } from "express";
import type { AppContext } from "../../../context";
import { ok, route } from "../../../middleware/validate";
import { getAnnouncementAudience } from "../../../services/announcements.service";

export function announcementRoutes(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  router.get(
    "/announcements/audience",
    route({}, async ({ req, res }) => {
      // Platform staff have no membership; the nil id excludes nobody.
      ok(res, await getAnnouncementAudience(ctx, req.tenantCtx!.tenant.id, req.membership?.id ?? "00000000-0000-0000-0000-000000000000"));
    }),
  );
  return router;
}
