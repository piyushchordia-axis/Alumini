import { platformJobRunSchema } from "@illuminize/shared";
import { Router } from "express";
import type { AppContext } from "../../context";
import { AppError } from "../../lib/errors";
import { ok, route } from "../../middleware/validate";
import { resetTenantRun } from "../../repositories/engagement.repo";
import { findTenantById } from "../../repositories/tenants.repo";
import { recordAudit } from "../../services/audit.service";
import { localClock } from "../../services/celebrations.service";
import { weekStartIn } from "../../services/digest.service";

export function platformJobRoutes(ctx: AppContext): Router {
  const router = Router();
  router.post(
    "/jobs/run",
    route({ body: platformJobRunSchema }, async ({ req, res, body }) => {
      const tenant = await findTenantById(ctx.db, body.tenantId);
      if (!tenant) throw AppError.notFound("Institution not found", "TENANT_NOT_FOUND");
      const now = new Date();
      const period = body.job === "digest" ? weekStartIn(now, tenant.timezone) : localClock(now, tenant.timezone).day;
      if (body.force) await resetTenantRun(ctx.db, body.job, tenant.id, period);
      if (body.job === "digest") await ctx.jobs.enqueue("digest.tenant", { tenantId: tenant.id, weekStart: period });
      else await ctx.jobs.enqueue("celebrations.tenant", { tenantId: tenant.id, day: period });
      await recordAudit(ctx, { tenantId: tenant.id, actorUserId: req.auth!.userId, action: "platform.job.run", metadata: { job: body.job, period, force: body.force }, ip: req.ip });
      ok(res, { queued: true, period });
    }),
  );
  return router;
}
