import { adminChatReportsQuerySchema } from "@illuminize/shared";
import { Router } from "express";
import type { AppContext } from "../../context";
import { noStore } from "../../middleware/noStore";
import { route } from "../../middleware/validate";
import { listPlatformChatReports } from "../../services/chat/adminReports.service";

/** Metadata only. Staff open a report through the institution's own admin routes, where each view is audited. */
export function platformChatReportRoutes(ctx: AppContext): Router {
  const router = Router();
  router.use("/chat-reports", noStore);
  router.get("/chat-reports", route({ query: adminChatReportsQuerySchema }, async ({ req, res, query }) => res.json(await listPlatformChatReports(ctx, req.auth!.userId, query))));
  return router;
}
