import { adminReportsQuerySchema, idParamsSchema, reportDismissSchema, reportResolveSchema } from "@illuminize/shared";
import { Router } from "express";
import type { AppContext } from "../../../context";
import { ok, route } from "../../../middleware/validate";
import { dismissReport, listAdminReports, resolveReport } from "../../../services/reports.service";
import { adminActor } from "../_actor";

export function adminReportRoutes(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  router.get("/reports", route({ query: adminReportsQuerySchema }, async ({ req, res, query }) => res.json(await listAdminReports(ctx, req.tenantCtx!.tenant.id, query))));
  router.post("/reports/:id/resolve", route({ params: idParamsSchema, body: reportResolveSchema }, async ({ req, res, params, body }) => ok(res, await resolveReport(ctx, req.tenantCtx!, adminActor(req), params.id, body))));
  router.post("/reports/:id/dismiss", route({ params: idParamsSchema, body: reportDismissSchema }, async ({ req, res, params, body }) => ok(res, await dismissReport(ctx, req.tenantCtx!, adminActor(req), params.id, body.note))));
  return router;
}
