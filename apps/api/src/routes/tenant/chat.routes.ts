import { chatBlockCreateSchema, chatConversationsQuerySchema, chatDirectCreateSchema, chatMessageCreateSchema, chatMessagesQuerySchema, chatMuteSchema, chatReadSchema, chatReportCreateSchema, cursorQuerySchema, idParamsSchema, membershipIdParamsSchema } from "@illuminize/shared";
import { Router, type Request, type RequestHandler } from "express";
import type { AppContext } from "../../context";
import { byMembership, rateLimit } from "../../middleware/rateLimit";
import { requireChatEligible, requireFeature, requireMember } from "../../middleware/tenant";
import { noContent, ok, route } from "../../middleware/validate";
import { blockMember, listMyBlocks, unblockMember } from "../../services/chat/blocks.service";
import { acceptRequest, declineRequest, getBadge, getConversation, listConversations, listMessages, markRead, sendDirect, sendMessage, setMute, type ChatActor } from "../../services/chat/chat.service";
import { reportMessage } from "../../services/chat/reports.service";

const actorOf = (req: Request): ChatActor => ({ userId: req.auth!.userId, membership: req.membership! });

// Private messages must never sit in a browser or proxy cache, and that holds for error responses too.
const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
};

export function chatRoutes(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  router.use("/chat", noStore, requireMember, requireChatEligible);

  const limit = (bucket: string, max: number, windowSec: number) => rateLimit(ctx, { bucket, limit: max, windowSec, keyFn: byMembership });
  const sendLimits = [limit("chat-send", 60, 60), limit("chat-send-hour", 600, 3600)];
  const readLimit = limit("chat-read", 120, 60);
  const blockLimit = limit("chat-block", 60, 3600);
  const reportLimit = limit("chat-report", 30, 3600);

  // Direct threads need `messaging`. Read per kind in the services, except here where the kind is already known.
  router.post("/chat/direct", requireFeature("messaging"), sendLimits, route({ body: chatDirectCreateSchema }, async ({ req, res, body }) => ok(res, await sendDirect(ctx, req.tenantCtx!, actorOf(req), body), 201)));
  router.get("/chat/conversations", route({ query: chatConversationsQuerySchema }, async ({ req, res, query }) => res.json(await listConversations(ctx, req.tenantCtx!, actorOf(req), query))));
  router.get("/chat/conversations/:id", route({ params: idParamsSchema }, async ({ req, res, params }) => ok(res, await getConversation(ctx, req.tenantCtx!, actorOf(req), params.id))));
  router.get("/chat/conversations/:id/messages", route({ params: idParamsSchema, query: chatMessagesQuerySchema }, async ({ req, res, params, query }) => res.json(await listMessages(ctx, req.tenantCtx!, actorOf(req), params.id, query))));
  router.post("/chat/conversations/:id/messages", sendLimits, route({ params: idParamsSchema, body: chatMessageCreateSchema }, async ({ req, res, params, body }) => ok(res, await sendMessage(ctx, req.tenantCtx!, actorOf(req), params.id, body), 201)));
  router.post("/chat/conversations/:id/read", readLimit, route({ params: idParamsSchema, body: chatReadSchema }, async ({ req, res, params, body }) => ok(res, await markRead(ctx, req.tenantCtx!, actorOf(req), params.id, body.seq))));
  router.put("/chat/conversations/:id/mute", readLimit, route({ params: idParamsSchema, body: chatMuteSchema }, async ({ req, res, params, body }) => ok(res, await setMute(ctx, req.tenantCtx!, actorOf(req), params.id, body.until))));
  router.post("/chat/conversations/:id/accept", readLimit, route({ params: idParamsSchema }, async ({ req, res, params }) => ok(res, await acceptRequest(ctx, req.tenantCtx!, actorOf(req), params.id))));
  router.post("/chat/conversations/:id/decline", readLimit, route({ params: idParamsSchema }, async ({ req, res, params }) => ok(res, await declineRequest(ctx, req.tenantCtx!, actorOf(req), params.id))));

  // These stay available when messaging is off: a school switching it off mustn't strand anyone mid-incident.
  router.get("/chat/badge", route({}, async ({ req, res }) => ok(res, await getBadge(ctx, req.tenantCtx!, actorOf(req)))));
  router.get("/chat/blocks", route({ query: cursorQuerySchema }, async ({ req, res, query }) => res.json(await listMyBlocks(ctx, req.tenantCtx!, actorOf(req), query))));
  router.post("/chat/blocks", blockLimit, route({ body: chatBlockCreateSchema }, async ({ req, res, body }) => ok(res, await blockMember(ctx, req.tenantCtx!, actorOf(req), body.membershipId), 201)));
  router.delete("/chat/blocks/:membershipId", blockLimit, route({ params: membershipIdParamsSchema }, async ({ req, res, params }) => {
    await unblockMember(ctx, req.tenantCtx!, actorOf(req), params.membershipId);
    noContent(res);
  }));
  router.post("/chat/messages/:id/report", reportLimit, route({ params: idParamsSchema, body: chatReportCreateSchema }, async ({ req, res, params, body }) => ok(res, await reportMessage(ctx, req.tenantCtx!, actorOf(req), params.id, body), 201)));

  return router;
}
