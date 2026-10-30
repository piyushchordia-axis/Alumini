import { contentRefParamsSchema, idParamsSchema, moderationActionSchema, moderationQuerySchema } from "@illuminize/shared";
import { Router } from "express";
import type { AppContext } from "../../../context";
import { AppError } from "../../../lib/errors";
import { ok, route } from "../../../middleware/validate";
import { getContentForAdmin, listModerationQueue, moderateContent, setPostPinnedState } from "../../../services/moderation.service";
import type { ContentActor } from "../../../services/content.common";
import type { Request } from "express";
import { adminActor } from "../_actor";

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

/** Admin reads of content need a membership for `isMine`; platform admins without one get a synthetic viewer. */
function adminViewer(req: Request): ContentActor {
  const membership =
    req.membership ??
    ({ id: NIL_UUID, role: "TENANT_ADMIN", status: "APPROVED", fullName: "Platform admin" } as unknown as NonNullable<Request["membership"]>);
  return { ...req.auth!, membership, ip: req.ip };
}

export function moderationRoutes(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });

  router.get("/moderation", route({ query: moderationQuerySchema }, async ({ req, res, query }) => res.json(await listModerationQueue(ctx, req.tenantCtx!.tenant.id, query))));

  router.get("/moderation/:contentType/:id", route({ params: contentRefParamsSchema }, async ({ req, res, params }) => ok(res, await getContentForAdmin(ctx, req.tenantCtx!, adminViewer(req), params.contentType, params.id))));

  for (const action of ["approve", "reject", "remove", "restore"] as const) {
    router.post(
      `/moderation/:contentType/:id/${action}`,
      route({ params: contentRefParamsSchema, body: moderationActionSchema }, async ({ req, res, params, body }) => {
        const result = await moderateContent(ctx, req.tenantCtx!, adminActor(req), params.contentType, params.id, action, body.note);
        const content = await getContentForAdmin(ctx, req.tenantCtx!, adminViewer(req), params.contentType, params.id);
        ok(res, { ...result, content });
      }),
    );
  }

  router.post("/moderation/POST/:id/pin", route({ params: idParamsSchema }, async ({ req, res, params }) => ok(res, await setPostPinnedState(ctx, req.tenantCtx!, adminViewer(req), params.id, true))));
  router.post("/moderation/POST/:id/unpin", route({ params: idParamsSchema }, async ({ req, res, params }) => ok(res, await setPostPinnedState(ctx, req.tenantCtx!, adminViewer(req), params.id, false))));
  router.post("/moderation/:contentType/:id/pin", (_req, _res, next) => next(AppError.badRequest("Only posts can be pinned")));
  return router;
}
