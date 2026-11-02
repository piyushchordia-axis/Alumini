import { adminChatReportsQuerySchema, chatReportResolveSchema, idParamsSchema, reportDismissSchema } from "@illuminize/shared";
import { Router } from "express";
import type { AppContext } from "../../../context";
import { noStore } from "../../../middleware/noStore";
import { byUser, rateLimit } from "../../../middleware/rateLimit";
import { ok, route } from "../../../middleware/validate";
import { dismissChatReport, listAdminChatReports, resolveChatReport, viewChatReport } from "../../../services/chat/adminReports.service";
import { chatReportViewer } from "../_actor";

/** Not behind a feature gate: an admin may have switched messaging off because of the very incident they're handling. */
export function adminChatReportRoutes(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  router.use("/chat-reports", noStore);
  const viewLimit = rateLimit(ctx, { bucket: "chat-report-view", limit: 120, windowSec: 3600, keyFn: byUser });

  router.get("/chat-reports", route({ query: adminChatReportsQuerySchema }, async ({ req, res, query }) => res.json(await listAdminChatReports(ctx, req.tenantCtx!.tenant.id, chatReportViewer(req), query))));
  router.post("/chat-reports/:id/view", viewLimit, route({ params: idParamsSchema }, async ({ req, res, params }) => ok(res, await viewChatReport(ctx, req.tenantCtx!, chatReportViewer(req), params.id))));
  router.post("/chat-reports/:id/resolve", route({ params: idParamsSchema, body: chatReportResolveSchema }, async ({ req, res, params, body }) => ok(res, await resolveChatReport(ctx, req.tenantCtx!, chatReportViewer(req), params.id, body))));
  router.post("/chat-reports/:id/dismiss", route({ params: idParamsSchema, body: reportDismissSchema }, async ({ req, res, params, body }) => ok(res, await dismissChatReport(ctx, req.tenantCtx!, chatReportViewer(req), params.id, body.note))));
  return router;
}
