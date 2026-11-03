import { celebrationRoutes } from "./celebrations.routes";
import { Router } from "express";
import type { AppContext } from "../../context";
import { requireAuth } from "../../middleware/auth";
import { loadMembership, resolveTenant, touchActivity } from "../../middleware/tenant";
import { adminRoutes } from "./admin";
import { businessRoutes } from "./businesses.routes";
import { chatGroupRoutes } from "./chatGroups.routes";
import { chatRoutes } from "./chat.routes";
import { directoryRoutes } from "./directory.routes";
import { eventRoutes } from "./events.routes";
import { fundingRoutes } from "./funding.routes";
import { jobRoutes } from "./jobs.routes";
import { membershipRoutes } from "./membership.routes";
import { mentorshipRoutes } from "./mentorship.routes";
import { notificationRoutes } from "./notifications.routes";
import { paymentRoutes } from "./payments.routes";
import { postRoutes } from "./posts.routes";
import { reportRoutes } from "./reports.routes";
import { uploadRoutes } from "./uploads.routes";

/** Mounted at /t/:tenantSlug — every route below requires a signed-in user and a resolvable tenant. */
export function tenantRouter(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  router.use(requireAuth(ctx), resolveTenant(ctx), loadMembership(ctx), touchActivity(ctx));

  router.use(membershipRoutes(ctx));
  router.use(notificationRoutes(ctx));
  router.use(uploadRoutes(ctx));
  router.use(directoryRoutes(ctx));
  router.use(jobRoutes(ctx));
  router.use(fundingRoutes(ctx));
  router.use(businessRoutes(ctx));
  router.use(chatRoutes(ctx));
  router.use(chatGroupRoutes(ctx));
  router.use(mentorshipRoutes(ctx));
  router.use(postRoutes(ctx));
  router.use(celebrationRoutes(ctx));
  router.use(eventRoutes(ctx));
  router.use(reportRoutes(ctx));
  router.use(paymentRoutes(ctx));
  router.use("/admin", adminRoutes(ctx));
  return router;
}
