import { idParamsSchema, platformTestMessageSchema } from "@illuminize/shared";
import { Router } from "express";
import type { AppContext } from "../../context";
import { toOutboundMessageDto } from "../../dto/messages.dto";
import { AppError } from "../../lib/errors";
import { normalizePhone } from "../../lib/phone";
import { ok, route } from "../../middleware/validate";
import { findMessage } from "../../repositories/messages.repo";
import { findUserById } from "../../repositories/users.repo";
import { recordAudit } from "../../services/audit.service";
import { queueMessage } from "../../services/messages/message.service";

/** Staff tools to check that WhatsApp, SMS and email are configured: send a test message and follow its status. */
export function platformMessageRoutes(ctx: AppContext): Router {
  const router = Router();
  router.post(
    "/messages/test",
    route({ body: platformTestMessageSchema }, async ({ req, res, body }) => {
      const staff = await findUserById(ctx.db, req.auth!.userId);
      const message = await queueMessage(ctx, {
        type: "PLATFORM_TEST",
        to: { phoneE164: body.phone ? normalizePhone(body.phone).e164 : null, email: body.email ?? null },
        payload: { sentBy: staff?.displayName ?? staff?.phoneE164 ?? "Illuminize staff" },
        ...(body.channels ? { channels: body.channels } : {}),
      });
      await recordAudit(ctx, { actorUserId: req.auth!.userId, action: "platform.messages.test", targetType: "outbound_message", targetId: message.id, metadata: { channels: message.channels }, ip: req.ip });
      ok(res, toOutboundMessageDto(message), 202);
    }),
  );
  router.get(
    "/messages/:id",
    route({ params: idParamsSchema }, async ({ res, params }) => {
      const message = await findMessage(ctx.db, params.id);
      if (!message) throw AppError.notFound("Message not found");
      ok(res, toOutboundMessageDto(message));
    }),
  );
  return router;
}
