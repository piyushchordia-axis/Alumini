import { ALLOWED_IMAGE_MIME, CHAT_ATTACHMENT_LIMIT_TEXT, type ChatAttachmentLinkDto } from "@illuminize/shared";
import {
  CHAT_ATTACHMENT_LINK_FRESH_MS,
  CHAT_ATTACHMENT_UNAVAILABLE_TEXT,
  chatKeys,
  chatUploadTimeoutMs,
  createAttachmentLinkLoader,
  trayAdd,
  trayAttachments,
  trayFailed,
  trayFromAttachments,
  trayFull,
  trayReady,
  trayRemove,
  trayRetry,
  type OutboxAttachment,
  type OutboxEntry,
  type TrayItem,
  type TrayPick,
} from "@illuminize/shared/chat";
import { errorMessage, isUploadCancelled, prepareImageFile, startUpload } from "@illuminize/shared/client";
import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useChatStore } from "@/stores/chatStore";

/*
 * Chat photos and PDFs on the web: the composer's trays (their uploads, which carry on when the member leaves the thread,
 * and the object URLs their photos preview from), and the short-lived links that show what was sent. All of it is memory
 * only and goes at sign-out (forgetChatAttachments).
 */

/** Each tray item's prepared file, kept for "Try again" until it's sent or removed. */
const sources = new Map<string, File>();
/** Each upload under way, by tray item, to cancel. */
const uploads = new Map<string, () => void>();
/** Every object URL made for a preview, so sign-out can let them all go. */
const previews = new Set<string>();
/**
 * A sent photo's preview, by attachment id, for a while after its message arrives: the bubble draws it under the
 * thumbnail until that loads, so the photo the member just sent doesn't blank for a moment.
 */
const sentPreviews = new Map<string, string>();
const timers = new Set<ReturnType<typeof setTimeout>>();
const SENT_PREVIEW_KEEP_MS = 60_000;
/** Moves on at every sign-out, so files still being prepared then don't land in the next member's tray. */
let session = 0;

let picks = 0;
const pickKey = () => `pick-${Date.now().toString(36)}-${(picks++).toString(36)}`;

const trayOf = (key: string): TrayItem[] => useChatStore.getState().trays[key] ?? [];
const setTray = (key: string, update: (tray: TrayItem[]) => TrayItem[]) => useChatStore.getState().setTray(key, update);

function preview(file: File): string {
  const uri = URL.createObjectURL(file);
  previews.add(uri);
  return uri;
}

function letGo(uri: string | null | undefined) {
  if (!uri || !previews.delete(uri)) return;
  URL.revokeObjectURL(uri);
}

function cancelUpload(itemKey: string) {
  uploads.get(itemKey)?.();
  uploads.delete(itemKey);
}

/**
 * A picked, pasted or dropped file made ready for the tray. A photo is prepared as any upload's is (smaller, upright, and
 * HEIC made a JPEG where the browser can read it); one the server can't take keeps its type, so the tray turns it away
 * with the shared words.
 */
async function prepare(file: File): Promise<TrayPick> {
  const key = pickKey();
  if (!file.type.startsWith("image/")) {
    sources.set(key, file);
    return { key, type: file.type, size: file.size, name: file.name };
  }
  const prepared = await prepareImageFile(file, { purpose: "image" });
  sources.set(key, prepared);
  const shown = (ALLOWED_IMAGE_MIME as readonly string[]).includes(prepared.type);
  return { key, type: prepared.type, size: prepared.size, name: prepared.name, previewUri: shown ? preview(prepared) : null };
}

function upload(slug: string, conversationId: string, trayKey: string, itemKey: string) {
  const file = sources.get(itemKey);
  const item = trayOf(trayKey).find((i) => i.key === itemKey);
  if (!file || !item) return;
  const running = startUpload((signal) => api.chat.attach(slug, conversationId, file, { name: item.kind === "FILE" ? (item.name ?? undefined) : undefined, signal }), chatUploadTimeoutMs(file.size));
  uploads.set(itemKey, running.cancel);
  // Only the upload still on record for the item settles it: one cancelled by a remove, or replaced by a retry, says nothing.
  const current = () => uploads.get(itemKey) === running.cancel;
  running.promise.then(
    (attachment) => {
      if (!current()) return;
      uploads.delete(itemKey);
      setTray(trayKey, (tray) => trayReady(tray, itemKey, attachment));
    },
    (err: unknown) => {
      if (!current()) return;
      uploads.delete(itemKey);
      if (!isUploadCancelled(err)) setTray(trayKey, (tray) => trayFailed(tray, itemKey, errorMessage(err)));
    },
  );
}

/**
 * Adds files to the tray of `trayKey` (the composer's draft key) and starts uploading each to the conversation. Resolves
 * to what to say about the first file turned away (the limit, or a type or size the message can't take), or null.
 */
export async function addToTray(slug: string, conversationId: string, trayKey: string, files: readonly File[]): Promise<string | null> {
  if (files.length === 0) return null;
  if (trayFull(trayOf(trayKey))) return CHAT_ATTACHMENT_LIMIT_TEXT;
  const started = session;
  const prepared = await Promise.all(files.map(prepare));
  if (started !== session) {
    for (const pick of prepared) {
      sources.delete(pick.key);
      letGo(pick.previewUri);
    }
    return null;
  }
  const result = trayAdd(trayOf(trayKey), prepared);
  setTray(trayKey, () => result.tray);
  for (const key of result.refusedKeys) {
    sources.delete(key);
    letGo(prepared.find((p) => p.key === key)?.previewUri);
  }
  for (const item of result.added) upload(slug, conversationId, trayKey, item.key);
  return result.refused;
}

/** Takes an item out, cancelling its upload and letting its preview go. Gives the tile to focus next (null: the attach button). */
export function removeFromTray(trayKey: string, itemKey: string): string | null {
  const result = trayRemove(trayOf(trayKey), itemKey);
  setTray(trayKey, () => result.tray);
  if (result.removed) {
    cancelUpload(itemKey);
    sources.delete(itemKey);
    letGo(result.removed.previewUri);
  }
  return result.focusKey;
}

/** Uploads a failed item again, from the file prepared the first time. */
export function retryTrayItem(slug: string, conversationId: string, trayKey: string, itemKey: string) {
  if (!sources.has(itemKey)) return;
  cancelUpload(itemKey);
  setTray(trayKey, (tray) => trayRetry(tray, itemKey));
  upload(slug, conversationId, trayKey, itemKey);
}

/**
 * Empties the tray into a send: what's uploaded, with each photo's preview, which the outbox entry now holds until it's
 * released (releaseOutboxAttachments). Nothing is let go here.
 */
export function takeTray(trayKey: string): OutboxAttachment[] {
  const tray = trayOf(trayKey);
  if (tray.length === 0) return [];
  for (const item of tray) sources.delete(item.key);
  setTray(trayKey, () => []);
  return trayAttachments(tray);
}

/** A send's attachments back in the composer, as when it was refused for going too fast and its words go back in the box. */
export function restoreTray(trayKey: string, attachments: readonly OutboxAttachment[]) {
  if (attachments.length) setTray(trayKey, (tray) => [...tray, ...trayFromAttachments(attachments)]);
}

/**
 * The chat sync's onOutboxRelease: an entry has left the outbox (its message arrived, or it was discarded), so its photos'
 * previews can go. A sent one's are kept a minute more for the bubble of the message that arrived (sentPreviewOf); a
 * discarded one's, which nothing will show, go at once.
 */
export function releaseOutboxAttachments(entry: OutboxEntry, { sent }: { sent: boolean }) {
  for (const a of entry.attachments ?? []) {
    const uri = a.previewUri;
    if (!uri || !previews.has(uri)) continue;
    if (!sent) {
      letGo(uri);
      continue;
    }
    sentPreviews.set(a.id, uri);
    const timer = setTimeout(() => {
      timers.delete(timer);
      sentPreviews.delete(a.id);
      letGo(uri);
    }, SENT_PREVIEW_KEEP_MS);
    timers.add(timer);
  }
}

/** The preview of a photo this member has just sent, while it's still kept. */
export const sentPreviewOf = (attachmentId: string): string | undefined => sentPreviews.get(attachmentId);

/**
 * A thread the member can't reach any more (they left its group): its tray emptied, cancelling the uploads, the previews its
 * unsent messages held let go, and its links dropped. Call it before the thread's outbox is removed.
 */
export function forgetThreadAttachments(qc: QueryClient, slug: string, conversationId: string, trayKey: string) {
  for (const item of trayOf(trayKey)) removeFromTray(trayKey, item.key);
  for (const entry of qc.getQueryData<OutboxEntry[]>(chatKeys.outbox(slug, conversationId)) ?? []) releaseOutboxAttachments(entry, { sent: false });
  qc.removeQueries({ queryKey: chatKeys.attachments(slug, conversationId) });
}

/** Signing out (or any end of the session): every upload stops and every preview goes, with the trays the store forgets. */
export function forgetChatAttachments() {
  session += 1;
  for (const cancel of uploads.values()) cancel();
  uploads.clear();
  sources.clear();
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
  sentPreviews.clear();
  for (const uri of previews) URL.revokeObjectURL(uri);
  previews.clear();
}

const linkLoader = createAttachmentLinkLoader((slug, conversationId, messageIds) => api.chat.attachmentLinks(slug, conversationId, messageIds));

/**
 * One message's signed links, fetched with every other message that asks at the same moment (one request per visible
 * batch). In memory only: used while fresh, dropped once they'd be stale, and gone at sign-out with the rest of "chat".
 */
export const attachmentLinksQuery = (slug: string, conversationId: string, messageId: string) =>
  queryOptions({
    queryKey: chatKeys.attachmentLinks(slug, conversationId, [messageId]),
    queryFn: () => linkLoader.load(slug, conversationId, messageId),
    staleTime: CHAT_ATTACHMENT_LINK_FRESH_MS,
    gcTime: CHAT_ATTACHMENT_LINK_FRESH_MS,
  });

/** One attachment's links, fetched again first unless they're fresh: what opening, downloading and sharing go by. */
export async function freshAttachmentLink(qc: QueryClient, slug: string, conversationId: string, messageId: string, attachmentId: string): Promise<ChatAttachmentLinkDto> {
  const data = await qc.fetchQuery(attachmentLinksQuery(slug, conversationId, messageId));
  const link = data.links.find((l) => l.id === attachmentId);
  if (!link) throw new Error(CHAT_ATTACHMENT_UNAVAILABLE_TEXT);
  return link;
}
