import { idParamsSchema, notificationsQuerySchema } from "@illuminize/shared";
import { Router } from "express";
import type { AppContext } from "../../context";
import { toNotificationDto } from "../../dto/membership.dto";
import { requireMember } from "../../middleware/tenant";
import { noContent, ok, route } from "../../middleware/validate";
import { countUnread, listNotifications, markAllRead, markRead } from "../../repositories/notifications.repo";

export function notificationRoutes(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  router.use("/notifications", requireMember);

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
      noContent(res);
    }),
  );

  router.post(
    "/notifications/:id/read",
    route({ params: idParamsSchema }, async ({ req, res, params }) => {
      // Unknown or already-read ids are treated as success (idempotent).
      await markRead(ctx.db, req.membership!.id, params.id);
      noContent(res);
    }),
  );

  return router;
}
