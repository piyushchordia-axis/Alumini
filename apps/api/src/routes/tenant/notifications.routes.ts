import { idParamsSchema, notificationPrefsUpdateSchema, notificationsQuerySchema } from "@illuminize/shared";
import { Router, type Request } from "express";
import { rooms } from "../../realtime/rooms";
import type { AppContext } from "../../context";
import { isTenantAdmin, requireAnyMembership } from "../../middleware/tenant";
import { noContent, ok, route } from "../../middleware/validate";
import { countUnread, markAllRead, markRead } from "../../repositories/notifications.repo";
import { listNotificationsForViewer } from "../../services/notifications/notification.service";
import { getNotificationPrefs, updateNotificationPrefs } from "../../services/notifications/prefs.service";

export function notificationRoutes(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  router.use("/notifications", requireAnyMembership);
  router.use("/notification-prefs", requireAnyMembership);

  router.get(
    "/notification-prefs",
    route({}, async ({ req, res }) => {
      ok(res, await getNotificationPrefs(ctx, req.membership!));
    }),
  );

  router.patch(
    "/notification-prefs",
    route({ body: notificationPrefsUpdateSchema }, async ({ req, res, body }) => {
      ok(res, await updateNotificationPrefs(ctx, req.membership!, body));
    }),
  );

  /** Keeps the bell in step on the member's other devices and tabs. */
  const syncUnread = async (req: Request) => {
    const count = await countUnread(ctx.db, req.membership!.id);
    ctx.realtime.emit(rooms.user(req.auth!.userId), "notification:unread", { tenantSlug: req.tenantCtx!.tenant.slug, membershipId: req.membership!.id, count });
  };

  router.get(
    "/notifications",
    route({ query: notificationsQuerySchema }, async ({ req, res, query }) => {
      // A demoted admin is no longer one, so their old new-member notices come without the request.
      const viewer = { tenantId: req.tenantCtx!.tenant.id, membershipId: req.membership!.id, isAdmin: isTenantAdmin(req) };
      res.json(await listNotificationsForViewer(ctx, viewer, query));
    }),
  );

  router.get(
    "/notifications/unread-count",
    route({}, async ({ req, res }) => {
      ok(res, { count: await countUnread(ctx.db, req.membership!.id) });
    }),
  );

  router.post(
    "/notifications/read-all",
    route({}, async ({ req, res }) => {
      await markAllRead(ctx.db, req.membership!.id);
      await syncUnread(req);
      noContent(res);
    }),
  );

  router.post(
    "/notifications/:id/read",
    route({ params: idParamsSchema }, async ({ req, res, params }) => {
      // Unknown or already-read ids are treated as success (idempotent).
      if (await markRead(ctx.db, req.membership!.id, params.id)) await syncUnread(req);
      noContent(res);
    }),
  );

  return router;
}
