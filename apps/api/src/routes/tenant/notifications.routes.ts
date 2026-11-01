import { idParamsSchema, notificationsQuerySchema } from "@illuminize/shared";
import { Router, type Request } from "express";
import { rooms } from "../../realtime/rooms";
import type { AppContext } from "../../context";
import { toNotificationDto } from "../../dto/membership.dto";
import { requireAnyMembership } from "../../middleware/tenant";
import { noContent, ok, route } from "../../middleware/validate";
import { countUnread, listNotifications, markAllRead, markRead } from "../../repositories/notifications.repo";

export function notificationRoutes(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  router.use("/notifications", requireAnyMembership);

  /** Keeps the bell in step on the member's other devices and tabs. */
  const syncUnread = async (req: Request) => {
    const count = await countUnread(ctx.db, req.membership!.id);
    ctx.realtime.emit(rooms.user(req.auth!.userId), "notification:unread", { tenantSlug: req.tenantCtx!.tenant.slug, membershipId: req.membership!.id, count });
  };

  router.get(
    "/notifications",
    route({ query: notificationsQuerySchema }, async ({ req, res, query }) => {
      const page = await listNotifications(ctx.db, req.membership!.id, query);
      res.json({ data: page.data.map(toNotificationDto), nextCursor: page.nextCursor });
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
