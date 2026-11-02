import { auditQuerySchema } from "@illuminize/shared";
import { Router } from "express";
import type { AppContext } from "../../../context";
import { toAuditDto } from "../../../dto/membership.dto";
import { buildPage } from "../../../lib/pagination";
import { route } from "../../../middleware/validate";
import { listAudit } from "../../../repositories/audit.repo";

export function auditRoutes(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  router.get(
    "/audit",
    route({ query: auditQuerySchema }, async ({ req, res, query }) => {
      const { rows, total } = await listAudit(ctx.db, { ...query, tenantId: req.tenantCtx!.tenant.id, viewerUserId: req.auth!.userId });
      res.json(buildPage(rows.map((r) => toAuditDto(r.entry, r.actorName)), query.page, query.pageSize, total));
    }),
  );
  return router;
}
