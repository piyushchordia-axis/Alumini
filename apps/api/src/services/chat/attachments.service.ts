import {
  CHAT_ATTACHMENT_LINK_TTL_SEC,
  CHAT_ATTACHMENT_TYPE_PROBLEM,
  CHAT_ATTACHMENT_UNSENT_HOURS,
  CHAT_FILE_MAX_BYTES,
  CHAT_FILE_SIZE_PROBLEM,
  IMAGE_SIZE_PROBLEM,
  MAX_UPLOAD_BYTES,
  type ChatAttachmentDto,
  type ChatAttachmentLinksDto,
} from "@illuminize/shared";
import { chatFileName } from "@illuminize/shared/chat";
import type { AppContext } from "../../context";
import type { DbClient, Tx } from "../../db/client";
import { toChatAttachmentDto, type ChatAttachmentLinks } from "../../dto/chat.dto";
import { AppError } from "../../lib/errors";
import { makeThumbnail, processImage, sniffChatFile } from "../../lib/images";
import { afterCommit, runInTransaction } from "../../lib/transaction";
import { consumeRateLimit, type RateLimitWindow } from "../../middleware/rateLimit";
import { consumeTenantDailyQuota, type TenantDailyQuota } from "../../middleware/tenantQuota";
import { keys as redisKeys } from "../../redis/keys";
import { findBlockedByMember, findThread, type ChatMessageRow } from "../../repositories/chat.repo";
import {
  chatAttachmentKeys,
  claimChatAttachments,
  deleteChatAttachmentsByIds,
  findChatAttachmentsByMessageIds,
  findOpenableChatAttachments,
  insertChatAttachment,
  lockChatAttachmentsForClaim,
  lockUnsentChatAttachmentsBefore,
  type ChatAttachmentInsert,
  type ChatAttachmentRow,
} from "../../repositories/chatAttachments.repo";
import type { TenantContext } from "../../types/request";
import type { PrivateStorage } from "../storage";
import { privateCopy, type PrivateMime } from "../storage/PrivateStorage";
import type { ChatActor } from "./chat.service";
import {
  asSeenBy,
  assertKindEnabled,
  assertMaySend,
  attachmentGone,
  attachmentsNotYet,
  attachmentsOff,
  attachmentsOn,
  blockedByYou,
  chatTenantOf,
  contactUnavailable,
  freshChatTenant,
  groupNotSendable,
  groupSendable,
  isReachable,
  planSend,
  planTakesAttachments,
  threadKindOf,
} from "./common";

/**
 * What a member's uploads may add up to in a day, in KB as they're stored (a photo after re-encoding, with its thumbnail),
 * on top of the route's count of uploads an hour.
 */
export const CHAT_ATTACH_BYTES_LIMIT: RateLimitWindow = { bucket: "chat-attach-bytes", limit: 200 * 1024, windowSec: 24 * 60 * 60 };

/** The chat files one institution's members may store in a day, all together: counted last, for a file about to be saved. */
export const CHAT_FILES_QUOTA: TenantDailyQuota = {
  key: redisKeys.chatFilesDay,
  cap: (config) => config.CHAT_FILES_PER_TENANT_DAILY_CAP,
  message: "This institution has reached today's limit on photos and files in chat. Please try again tomorrow.",
  logMessage: "Tenant chat file quota reached",
};

const HOUR_MS = 60 * 60 * 1000;
const SWEEP_BATCH = 200;
const SWEEP_MAX_BATCHES = 10;

/**
 * Whether this member may upload to this conversation now, worked out before the upload is counted or read: it's theirs
 * and its kind is on, the institution (read fresh) has Chat attachments on, and a send there could carry them: a group
 * that takes messages, or a direct thread that is accepted or that their reply would accept. Never a request, asking again
 * included. A block by the other member passes, as it does for words, so a block can't show.
 */
export async function assertMayAttach(ctx: AppContext, tenantCtx: TenantContext, actor: ChatActor, conversationId: string): Promise<void> {
  const me = actor.membership.id;
  const tenant = await freshChatTenant(ctx.db, tenantCtx.tenant.id);
  const thread = await findThread(ctx.db, tenant.id, me, conversationId);
  if (!thread) throw AppError.notFound("Conversation not found");
  assertMaySend(tenant, actor.membership, threadKindOf(thread.conversation, thread.group));
  if (!attachmentsOn(tenant.features)) throw attachmentsOff();
  if (thread.group) {
    if (!groupSendable(thread.group)) throw groupNotSendable(thread.group);
    return;
  }
  if (!isReachable(tenant, thread.peer)) throw contactUnavailable();
  if (thread.blockedByMe) throw blockedByYou();
  if (!planTakesAttachments(planSend(asSeenBy(thread.conversation, thread.participant), me, new Date()))) throw attachmentsNotYet();
}

export interface ChatUploadFile {
  buffer: Buffer;
  /** The name the member's device gave it, as sent; only a PDF keeps one, cleaned. */
  name: string | null;
}

/**
 * Stores a photo or PDF for a message the member is about to send, after assertMayAttach: unsent until a send claims it,
 * and swept a day later if none does. The bytes decide what it is. A photo is re-encoded (upright, no metadata, GPS
 * included, at most MAX_IMAGE_SIDE) and gets a thumbnail; a PDF is kept as it came. Only then, just before it's saved,
 * does it count against the member's daily bytes and the institution's daily files, so a file refused for what it is
 * costs neither.
 */
export async function uploadChatAttachment(ctx: AppContext, tenantCtx: TenantContext, actor: ChatActor, conversationId: string, file: ChatUploadFile): Promise<ChatAttachmentDto> {
  const tenantId = tenantCtx.tenant.id;
  const mime = sniffChatFile(file.buffer);
  if (!mime) throw new AppError(415, "UNSUPPORTED_MEDIA", CHAT_ATTACHMENT_TYPE_PROBLEM);

  let copies: Array<{ buffer: Buffer; mime: PrivateMime; fileName: string | null }>;
  let row: Omit<ChatAttachmentInsert, "storageKey" | "thumbKey">;
  if (mime === "application/pdf") {
    if (file.buffer.length > CHAT_FILE_MAX_BYTES) throw new AppError(413, "PAYLOAD_TOO_LARGE", CHAT_FILE_SIZE_PROBLEM);
    const fileName = chatFileName(file.name);
    copies = [{ buffer: file.buffer, mime, fileName }];
    row = { tenantId, conversationId, uploaderMembershipId: actor.membership.id, kind: "FILE", contentType: mime, byteSize: file.buffer.length, fileName };
  } else {
    // A photo comes prepared on the device, so one over the limit of any upload is refused rather than shrunk here.
    if (file.buffer.length > MAX_UPLOAD_BYTES) throw new AppError(413, "PAYLOAD_TOO_LARGE", IMAGE_SIZE_PROBLEM);
    const image = await processImage(file.buffer, mime, "image");
    const thumb = await makeThumbnail(image.buffer);
    copies = [
      { buffer: image.buffer, mime: image.mime, fileName: null },
      { buffer: thumb.buffer, mime: thumb.mime, fileName: null },
    ];
    row = { tenantId, conversationId, uploaderMembershipId: actor.membership.id, kind: "PHOTO", contentType: image.mime, byteSize: image.buffer.length, width: image.width, height: image.height };
  }

  const storedBytes = copies.reduce((n, c) => n + c.buffer.length, 0);
  await consumeRateLimit(ctx, CHAT_ATTACH_BYTES_LIMIT, actor.membership.id, Math.ceil(storedBytes / 1024));
  await consumeTenantDailyQuota(ctx, tenantId, CHAT_FILES_QUOTA);

  const keys: string[] = [];
  try {
    for (const copy of copies) keys.push((await ctx.privateStorage.save({ tenantId, buffer: copy.buffer, mime: copy.mime, fileName: copy.fileName })).key);
    const saved = await insertChatAttachment(ctx.db, { ...row, storageKey: keys[0]!, thumbKey: keys[1] ?? null });
    return toChatAttachmentDto(saved);
  } catch (err) {
    // A file no row records could never be found again, let alone deleted.
    await removeChatFiles(ctx, keys);
    throw err;
  }
}

/**
 * Claims a send's uploads for its message, inside appendMessage's transaction, after the conversation (and the sender's
 * participant row) are locked: each must be this sender's, in this conversation, and unsent. Anything else (sent already,
 * swept, someone else's, another thread's) fails the whole send, so nothing of it is saved.
 */
export async function claimChatAttachmentsFor(tx: Tx, input: { ids: string[]; conversationId: string; uploaderMembershipId: string; messageId: string }): Promise<ChatAttachmentRow[]> {
  const locked = await lockChatAttachmentsForClaim(tx, { ids: input.ids, conversationId: input.conversationId, uploaderMembershipId: input.uploaderMembershipId });
  if (locked.length !== input.ids.length) throw attachmentGone();
  const claimed = await claimChatAttachments(tx, { ids: input.ids, messageId: input.messageId });
  return claimed.sort((a, b) => a.position - b.position);
}

/** These messages' photos and files, each message's in order, keyed by message. */
export async function attachmentsByMessage(db: DbClient, messageIds: string[]): Promise<Map<string, ChatAttachmentRow[]>> {
  const byMessage = new Map<string, ChatAttachmentRow[]>();
  for (const row of await findChatAttachmentsByMessageIds(db, messageIds)) {
    const list = byMessage.get(row.messageId!) ?? [];
    list.push(row);
    byMessage.set(row.messageId!, list);
  }
  return byMessage;
}

/** One message's photos and files, in order; none for a system line, which never has any. */
export async function messageAttachments(db: DbClient, message: Pick<ChatMessageRow, "id" | "kind">): Promise<ChatAttachmentRow[]> {
  return message.kind === "TEXT" ? (await attachmentsByMessage(db, [message.id])).get(message.id) ?? [] : [];
}

/**
 * When links signed now for `ttlSec` stop working, never later than the links themselves: they count whole seconds from
 * when each is signed, which is after this.
 */
export const linksExpireAt = (ttlSec: number, nowMs = Date.now()): Date => new Date(Math.floor(nowMs / 1000) * 1000 + ttlSec * 1000);

/** Signs each attachment's copies: the photo or file, a photo's thumbnail, and its download. Bearer links: never stored or logged. */
export async function signChatAttachmentLinks(storage: PrivateStorage, rows: readonly ChatAttachmentRow[], ttlSec: number): Promise<Map<string, ChatAttachmentLinks>> {
  const sign = (row: ChatAttachmentRow, variant: "full" | "thumb" | "download") => {
    const copy = privateCopy(row, variant);
    return copy ? storage.link({ attachmentId: row.id, key: copy.key, variant, contentType: copy.contentType, ttlSec }) : Promise.resolve(null);
  };
  const signed = await Promise.all(rows.map(async (row) => [row.id, { url: (await sign(row, "full"))!, thumbUrl: await sign(row, "thumb"), downloadUrl: (await sign(row, "download"))! }] as const));
  return new Map(signed);
}

/**
 * Short-lived links to the photos and files of some of a conversation's messages, for a member in it. The thread must be
 * theirs, and of a kind that's switched on, as on every read; the Chat attachments switch doesn't come into it, so what
 * was sent stays open. A message they may not open (from before they joined, withheld from them, removed, redacted for
 * them, or not in this conversation) is left out of the answer, never refused on its own.
 */
export async function chatAttachmentLinks(ctx: AppContext, tenantCtx: TenantContext, actor: ChatActor, conversationId: string, messageIds: string[]): Promise<ChatAttachmentLinksDto> {
  const tenant = chatTenantOf(tenantCtx);
  const me = actor.membership.id;
  const thread = await findThread(ctx.db, tenant.id, me, conversationId);
  if (!thread) throw AppError.notFound("Conversation not found");
  assertKindEnabled(tenant.features, threadKindOf(thread.conversation, thread.group));
  const rows = await findOpenableChatAttachments(ctx.db, {
    conversationId,
    messageIds,
    viewerMembershipId: me,
    joinedSeq: thread.participant.joinedSeq,
    redactedSenderIds: thread.group ? await findBlockedByMember(ctx.db, me) : [],
  });
  const expiresAt = linksExpireAt(CHAT_ATTACHMENT_LINK_TTL_SEC);
  const links = await signChatAttachmentLinks(ctx.privateStorage, rows, CHAT_ATTACHMENT_LINK_TTL_SEC);
  return { expiresAt: expiresAt.toISOString(), links: rows.map((row) => ({ id: row.id, messageId: row.messageId!, ...links.get(row.id)! })) };
}

/**
 * Deletes chat files from private storage. Never throws: it runs after a commit, and a file left behind is only space. It
 * logs how many failed and never which, since a key leads to the file.
 */
export async function removeChatFiles(ctx: Pick<AppContext, "privateStorage" | "logger">, keys: readonly string[]): Promise<void> {
  let failed = 0;
  let lastError: unknown = null;
  for (const key of keys) {
    try {
      await ctx.privateStorage.delete(key);
    } catch (err) {
      failed += 1;
      lastError = err;
    }
  }
  if (failed > 0) ctx.logger.warn({ err: lastError, count: failed }, "Some chat files could not be deleted");
}

/**
 * Deletes uploads no send claimed within CHAT_ATTACHMENT_UNSENT_HOURS, a batch per transaction: the rows go in it, and
 * their files once it commits, so a row never points at a missing file. Rows a send holds while claiming them are
 * skipped, and that send finds what it locked; a send that comes after finds them gone (CHAT_ATTACHMENT_GONE).
 */
export async function sweepUnsentChatAttachments(ctx: AppContext, now = new Date()): Promise<number> {
  const before = new Date(now.getTime() - CHAT_ATTACHMENT_UNSENT_HOURS * HOUR_MS);
  let swept = 0;
  for (let batch = 0; batch < SWEEP_MAX_BATCHES; batch++) {
    const count = await runInTransaction(ctx, async (tx) => {
      const rows = await lockUnsentChatAttachmentsBefore(tx, before, SWEEP_BATCH);
      if (rows.length === 0) return 0;
      await deleteChatAttachmentsByIds(tx, rows.map((r) => r.id));
      const keys = rows.flatMap(chatAttachmentKeys);
      await afterCommit(ctx, tx, () => removeChatFiles(ctx, keys));
      return rows.length;
    });
    swept += count;
    if (count < SWEEP_BATCH) break;
  }
  if (swept > 0) ctx.logger.info({ count: swept }, "Swept unsent chat attachments");
  return swept;
}
