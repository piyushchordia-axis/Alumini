import { Router } from "express";
import type { AppContext } from "../../../context";
import { requireTenantAdmin } from "../../../middleware/tenant";
import { analyticsRoutes } from "./analytics.routes";
import { announcementRoutes } from "./announcements.routes";
import { auditRoutes } from "./audit.routes";
import { dashboardRoutes } from "./dashboard.routes";
import { memberRoutes } from "./members.routes";
import { invitationRoutes } from "./invitations.routes";
import { moderationRoutes } from "./moderation.routes";
import { profileFieldRoutes } from "./profileFields.routes";
import { adminReportRoutes } from "./reports.routes";
import { settingsRoutes } from "./settings.routes";

export function adminRoutes(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  router.use(requireTenantAdmin);
  router.use(dashboardRoutes(ctx));
  router.use(analyticsRoutes(ctx));
  router.use(memberRoutes(ctx));
  router.use(moderationRoutes(ctx));
  router.use(adminReportRoutes(ctx));
  router.use(settingsRoutes(ctx));
  router.use(profileFieldRoutes(ctx));
  router.use(invitationRoutes(ctx));
  router.use(announcementRoutes(ctx));
  router.use(auditRoutes(ctx));
  return router;
}
