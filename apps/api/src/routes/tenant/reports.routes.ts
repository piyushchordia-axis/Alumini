import { myReportsQuerySchema, reportCreateSchema } from "@illuminize/shared";
import { Router } from "express";
import type { AppContext } from "../../context";
import { byMembership, rateLimit } from "../../middleware/rateLimit";
import { requireMember } from "../../middleware/tenant";
import { ok, route } from "../../middleware/validate";
import { createReport, listMyReports } from "../../services/reports.service";
import { contentActor } from "./_actor";

export function reportRoutes(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  router.use("/reports", requireMember);
  router.post(
    "/reports",
    rateLimit(ctx, { bucket: "report-create", limit: 30, windowSec: 3600, keyFn: byMembership }),
    route({ body: reportCreateSchema }, async ({ req, res, body }) => ok(res, await createReport(ctx, req.tenantCtx!, contentActor(req), body), 201)),
  );
  router.get("/reports/mine", route({ query: myReportsQuerySchema }, async ({ req, res, query }) => res.json(await listMyReports(ctx, req.tenantCtx!.tenant.id, contentActor(req), query))));
  return router;
}
