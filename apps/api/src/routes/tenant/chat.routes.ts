import {
  CHAT_ATTACHMENT_TYPE_PROBLEM,
  CHAT_FILE_MAX_BYTES,
  CHAT_FILE_SIZE_PROBLEM,
  IMAGE_SIZE_PROBLEM,
  chatAttachmentLinksQuerySchema,
  chatBlockCreateSchema,
  chatConversationsQuerySchema,
  chatDirectCreateSchema,
  chatMessageCreateSchema,
  chatMessagesQuerySchema,
  chatMuteSchema,
  chatReadSchema,
  chatReportCreateSchema,
  cursorQuerySchema,
  idParamsSchema,
  membershipIdParamsSchema,
} from "@illuminize/shared";
import { Router, type Request, type RequestHandler } from "express";
import multer from "multer";
import type { AppContext } from "../../context";
import { AppError } from "../../lib/errors";
import { noStore } from "../../middleware/noStore";
import { byMembership, rateLimit } from "../../middleware/rateLimit";
import { requireChatEligible, requireFeature, requireMember } from "../../middleware/tenant";
import { noContent, ok, route } from "../../middleware/validate";
import { assertMayAttach, chatAttachmentLinks, uploadChatAttachment } from "../../services/chat/attachments.service";
import { blockMember, listMyBlocks, unblockMember } from "../../services/chat/blocks.service";
import { acceptRequest, declineRequest, findDirectThread, getBadge, getConversation, listConversations, listMessages, markRead, sendDirect, sendMessage, setMute, type ChatActor } from "../../services/chat/chat.service";
import { reportMessage } from "../../services/chat/reports.service";

const actorOf = (req: Request): ChatActor => ({ userId: req.auth!.userId, membership: req.membership! });

/** The type each upload said it was, for the words of a refusal over the size limit, which comes before the bytes are read. */
const declaredTypes = new WeakMap<Request, string>();

// The declared type only turns away what is plainly neither a photo nor a PDF; uploadChatAttachment decides by the bytes.
const ACCEPTED_DECLARED = new Set(["application/pdf", "application/x-pdf", "application/octet-stream", ""]);

const chatUpload = multer({
  storage: multer.memoryStorage(),
  // One file and its name, sent as a field of its own; a part's own name is read as UTF-8, as browsers write it.
  limits: { fileSize: CHAT_FILE_MAX_BYTES, files: 1, fields: 2, fieldSize: 4096, parts: 3 },
  defParamCharset: "utf8",
  fileFilter: (req, file, cb) => {
    const declared = (file.mimetype ?? "").toLowerCase();
    declaredTypes.set(req, declared);
    if (declared.startsWith("image/") || ACCEPTED_DECLARED.has(declared)) cb(null, true);
    else cb(new AppError(415, "UNSUPPORTED_MEDIA", CHAT_ATTACHMENT_TYPE_PROBLEM));
  },
});

/** Reads the one file, refusing one over the limit in the words the apps use for their own check. */
const chatFile: RequestHandler = (req, res, next) => {
  chatUpload.single("file")(req, res, (err?: unknown) => {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return next(new AppError(413, "PAYLOAD_TOO_LARGE", declaredTypes.get(req)?.startsWith("image/") ? IMAGE_SIZE_PROBLEM : CHAT_FILE_SIZE_PROBLEM));
    }
    next(err);
  });
};

export function chatRoutes(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  router.use("/chat", noStore, requireMember, requireChatEligible);

  const limit = (bucket: string, max: number, windowSec: number) => rateLimit(ctx, { bucket, limit: max, windowSec, keyFn: byMembership });
  const sendLimits = [limit("chat-send", 60, 60), limit("chat-send-hour", 600, 3600)];
  const readLimit = limit("chat-read", 120, 60);
  const blockLimit = limit("chat-block", 60, 3600);
  const reportLimit = limit("chat-report", 30, 3600);
  const attachLimit = limit("chat-attach", 60, 3600);
  const fileLinksLimit = limit("chat-file-links", 300, 60);
  /**
   * Before anything is counted or the file is read, so an upload the send would refuse costs no limit or quota. The
   * member's bytes and the institution's daily files are counted in uploadChatAttachment, once the file has passed.
   */
  const mayAttach: RequestHandler = async (req, _res, next) => {
    try {
      await assertMayAttach(ctx, req.tenantCtx!, actorOf(req), idParamsSchema.parse(req.params).id);
      next();
    } catch (err) {
      next(err);
    }
  };

  // Direct threads need `messaging`. Read per kind in the services, except here where the kind is already known.
  router.post("/chat/direct", requireFeature("messaging"), sendLimits, route({ body: chatDirectCreateSchema }, async ({ req, res, body }) => ok(res, await sendDirect(ctx, req.tenantCtx!, actorOf(req), body), 201)));
  router.get("/chat/direct/:membershipId", requireFeature("messaging"), readLimit, route({ params: membershipIdParamsSchema }, async ({ req, res, params }) => ok(res, await findDirectThread(ctx, req.tenantCtx!, actorOf(req), params.membershipId))));
  router.get("/chat/conversations", route({ query: chatConversationsQuerySchema }, async ({ req, res, query }) => res.json(await listConversations(ctx, req.tenantCtx!, actorOf(req), query))));
  router.get("/chat/conversations/:id", route({ params: idParamsSchema }, async ({ req, res, params }) => ok(res, await getConversation(ctx, req.tenantCtx!, actorOf(req), params.id))));
  router.get("/chat/conversations/:id/messages", route({ params: idParamsSchema, query: chatMessagesQuerySchema }, async ({ req, res, params, query }) => res.json(await listMessages(ctx, req.tenantCtx!, actorOf(req), params.id, query))));
  router.post("/chat/conversations/:id/messages", sendLimits, route({ params: idParamsSchema, body: chatMessageCreateSchema }, async ({ req, res, params, body }) => ok(res, await sendMessage(ctx, req.tenantCtx!, actorOf(req), params.id, body), 201)));
  router.post(
    "/chat/conversations/:id/attachments",
    mayAttach,
    attachLimit,
    chatFile,
    route({ params: idParamsSchema }, async ({ req, res, params }) => {
      const file = req.file;
      if (!file) throw AppError.badRequest("Attach a photo or a PDF in the 'file' field");
      const field = (req.body as Record<string, unknown> | undefined)?.name;
      const name = typeof field === "string" ? field : file.originalname || null;
      ok(res, await uploadChatAttachment(ctx, req.tenantCtx!, actorOf(req), params.id, { buffer: file.buffer, name }), 201);
    }),
  );
  // Still open with Chat attachments off, so what was sent can be seen.
  router.get("/chat/conversations/:id/attachments", fileLinksLimit, route({ params: idParamsSchema, query: chatAttachmentLinksQuerySchema }, async ({ req, res, params, query }) => ok(res, await chatAttachmentLinks(ctx, req.tenantCtx!, actorOf(req), params.id, query.messageId))));
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
