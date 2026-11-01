import { booleanQuerySchema, profileFieldCreateSchema, profileFieldIdParamsSchema, profileFieldReorderSchema, profileFieldUpdateSchema } from "@illuminize/shared";
import { Router, type Request } from "express";
import { z } from "zod";
import type { AppContext } from "../../../context";
import { ok, route } from "../../../middleware/validate";
import { createProfileField, listFieldsForAdmin, reorderProfileFields, setProfileFieldArchived, updateProfileFieldDef } from "../../../services/profileFields.service";
import { adminActor } from "../_actor";

export function profileFieldRoutes(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  const tenantId = (req: Request) => req.tenantCtx!.tenant.id;

  router.get(
    "/profile-fields",
    route({ query: z.object({ includeArchived: booleanQuerySchema.optional() }) }, async ({ req, res, query }) => {
      ok(res, await listFieldsForAdmin(ctx, tenantId(req), !!query.includeArchived));
    }),
  );
  router.post(
    "/profile-fields",
    route({ body: profileFieldCreateSchema }, async ({ req, res, body }) => {
      ok(res, await createProfileField(ctx, tenantId(req), adminActor(req), body), 201);
    }),
  );
  router.post(
    "/profile-fields/reorder",
    route({ body: profileFieldReorderSchema }, async ({ req, res, body }) => {
      ok(res, await reorderProfileFields(ctx, tenantId(req), adminActor(req), body.ids));
    }),
  );
  router.patch(
    "/profile-fields/:fieldId",
    route({ params: profileFieldIdParamsSchema, body: profileFieldUpdateSchema }, async ({ req, res, params, body }) => {
      ok(res, await updateProfileFieldDef(ctx, tenantId(req), adminActor(req), params.fieldId, body));
    }),
  );
  router.post(
    "/profile-fields/:fieldId/archive",
    route({ params: profileFieldIdParamsSchema }, async ({ req, res, params }) => {
      ok(res, await setProfileFieldArchived(ctx, tenantId(req), adminActor(req), params.fieldId, true));
    }),
  );
  router.post(
    "/profile-fields/:fieldId/restore",
    route({ params: profileFieldIdParamsSchema }, async ({ req, res, params }) => {
      ok(res, await setProfileFieldArchived(ctx, tenantId(req), adminActor(req), params.fieldId, false));
    }),
  );
  return router;
}
