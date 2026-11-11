import { ALLOWED_IMAGE_MIME, CHAT_ATTACHMENT_LIMIT_TEXT, IMAGE_TYPE_PROBLEM, type ChatAttachmentDto, type ChatAttachmentLinkDto } from "@illuminize/shared";
import {
  CHAT_ATTACHMENT_LINK_FRESH_MS,
  CHAT_ATTACHMENT_UNAVAILABLE_TEXT,
  CHAT_FILE_DEFAULT_NAME,
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
  trayRoom,
  type OutboxAttachment,
  type OutboxEntry,
  type TrayItem,
  type TrayPick,
} from "@illuminize/shared/chat";
import { errorMessage, isUploadCancelled, prepareImageFile, startUpload } from "@illuminize/shared/client";
import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { File as FsFile } from "expo-file-system";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";
import { api } from "@/lib/api";
import { discardPickedFile, forgetOpenedFiles, openPrivateFile, pickChatFiles } from "@/lib/files";
import { discardPickedPhoto, discardPreparedPhoto, preparePickedPhoto } from "@/lib/photos";
import { useChatStore } from "@/stores/chatStore";

/*
 * Chat photos and PDFs on the phone: the composer's trays (their uploads, which carry on when the member leaves the
 * thread, and the files their photos preview from), and the short-lived links that show what was sent. Nothing here is
 * stored: it's memory and the app's cache, and all of it goes at sign-out (forgetChatAttachments).
 *
 * The picker's copy of a photo is deleted as soon as it's prepared. The prepared copy is the tile's preview, then the
 * sending bubble's, so it's kept until its tray item is removed or its outbox entry is released (and a minute more for a
 * sent one, under its thumbnail; a discarded one's goes at once), then deleted. A picked PDF's copy is kept for Try again
 * until it has uploaded.
 */

const UNREADABLE = "Couldn't open that photo. Try another one.";
const NO_PHOTO_ACCESS = "Allow photo access to choose photos.";
const WEB = Platform.OS === "web";

/** What a tray item uploads from: the web build's File, or a file in the app's cache. */
type Source = { file: File } | { uri: string; name: string; type: string };

const sources = new Map<string, Source>();
/** Each upload under way, by tray item, to cancel. */
const uploads = new Map<string, () => void>();
/** Prepared photos on the phone: each one a tray item's or an outbox entry's preview until it's let go. */
const preparedPhotos = new Set<string>();
/** Picked PDFs' copies on the phone, until they've uploaded or been taken out. */
const pickedFiles = new Set<string>();
/** The web build's object URLs for previews. */
const previews = new Set<string>();
/** A sent photo's preview, by attachment id, for a minute after its message arrives: the bubble draws it under the thumbnail. */
const sentPreviews = new Map<string, string>();
const timers = new Set<ReturnType<typeof setTimeout>>();
const SENT_PREVIEW_KEEP_MS = 60_000;
/** Moves on at every sign-out, so photos still being prepared then don't land in the next member's tray. */
let session = 0;

let picks = 0;
const pickKey = () => `pick-${Date.now().toString(36)}-${(picks++).toString(36)}`;

const trayOf = (key: string): TrayItem[] => useChatStore.getState().trays[key] ?? [];
const setTray = (key: string, update: (tray: TrayItem[]) => TrayItem[]) => useChatStore.getState().setTray(key, update);

/** A preview no longer shown anywhere: the web build's address revoked, the phone's prepared copy deleted. */
function letGo(uri: string | null | undefined) {
  if (!uri) return;
  if (previews.delete(uri)) URL.revokeObjectURL(uri);
  else if (preparedPhotos.delete(uri)) discardPreparedPhoto(uri);
}

/** Forgets what an item uploads from, deleting a PDF's copy. A photo's copy is its preview, which letGo deals with. */
function dropSource(itemKey: string) {
  const source = sources.get(itemKey);
  sources.delete(itemKey);
  if (source && "uri" in source && pickedFiles.delete(source.uri)) discardPickedFile(source.uri);
}

function cancelUpload(itemKey: string) {
  uploads.get(itemKey)?.();
  uploads.delete(itemKey);
}

/** Expo's fetch sends a part that reads its own bytes, and refuses one with only a uri. */
const readBytes = async (uri: string) => new Uint8Array(await new FsFile(uri).arrayBuffer());

/**
 * One picked photo made ready for the tray, as any upload's is (preparePickedPhoto on a phone, prepareImageFile in the
 * browser build). One the server can't take keeps its type, so the tray turns it away with the shared words. Throws when
 * the phone can't read it.
 */
async function preparePhoto(asset: ImagePicker.ImagePickerAsset): Promise<TrayPick> {
  const key = pickKey();
  if (WEB) {
    const picked = asset.file ?? new File([await (await fetch(asset.uri)).blob()], asset.fileName ?? "photo", { type: asset.mimeType ?? "" });
    if (!picked.type.startsWith("image/")) return { key, type: picked.type, size: picked.size, name: picked.name };
    const prepared = await prepareImageFile(picked, { purpose: "image" });
    sources.set(key, { file: prepared });
    let previewUri: string | null = null;
    if ((ALLOWED_IMAGE_MIME as readonly string[]).includes(prepared.type)) {
      previewUri = URL.createObjectURL(prepared);
      previews.add(previewUri);
    }
    return { key, type: prepared.type, size: prepared.size, name: prepared.name, previewUri };
  }
  try {
    const photo = await preparePickedPhoto(asset, "image");
    preparedPhotos.add(photo.uri);
    sources.set(key, { uri: photo.uri, name: photo.name, type: photo.type });
    return { key, type: photo.type, size: photo.size, name: photo.name, previewUri: photo.uri };
  } finally {
    discardPickedPhoto(asset.uri);
  }
}

/** Picks photos from the library, at most `limit`, and prepares them one at a time, so a phone holds one photo in memory at once. */
async function pickPhotos(limit: number): Promise<{ picks: TrayPick[]; problem: string | null }> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return { picks: [], problem: NO_PHOTO_ACCESS };
  let result: ImagePicker.ImagePickerResult;
  try {
    // Quality 1 hands over the photo as it is, so preparing it is its one lossy pass (see useImageUpload).
    result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1, allowsMultipleSelection: limit > 1, selectionLimit: limit });
  } catch (err) {
    // The browser build's picker refuses what isn't an image; a phone's fails when a photo can't be read.
    return { picks: [], problem: WEB || /unsupported file type/i.test(errorMessage(err, "")) ? IMAGE_TYPE_PROBLEM : UNREADABLE };
  }
  if (result.canceled) return { picks: [], problem: null };
  const prepared: TrayPick[] = [];
  let problem: string | null = null;
  for (const asset of result.assets) {
    try {
      prepared.push(await preparePhoto(asset));
    } catch {
      problem ??= UNREADABLE;
    }
  }
  return { picks: prepared, problem };
}

/** Lets go of picks that won't go in a tray: their sources, and their previews. */
function release(picked: readonly TrayPick[]) {
  for (const pick of picked) {
    dropSource(pick.key);
    letGo(pick.previewUri);
  }
}

function upload(slug: string, conversationId: string, trayKey: string, itemKey: string) {
  const source = sources.get(itemKey);
  const item = trayOf(trayKey).find((i) => i.key === itemKey);
  if (!source || !item) return;
  const name = item.kind === "FILE" ? (item.name ?? CHAT_FILE_DEFAULT_NAME) : undefined;
  const part = "file" in source ? source.file : { uri: source.uri, name: name ?? source.name, type: item.contentType, bytes: () => readBytes(source.uri) };
  const running = startUpload((signal) => api.chat.attach(slug, conversationId, part, { name, signal }), chatUploadTimeoutMs(item.size));
  uploads.set(itemKey, running.cancel);
  // Only the upload still on record for the item settles it: one cancelled by a remove, or replaced by a retry, says nothing.
  const current = () => uploads.get(itemKey) === running.cancel;
  running.promise.then(
    (attachment) => {
      if (!current()) return;
      uploads.delete(itemKey);
      setTray(trayKey, (tray) => trayReady(tray, itemKey, attachment));
      // A PDF needs no copy once it's up: nothing tries it again, and it has no preview.
      if (item.kind === "FILE") dropSource(itemKey);
    },
    (err: unknown) => {
      if (!current()) return;
      uploads.delete(itemKey);
      if (!isUploadCancelled(err)) setTray(trayKey, (tray) => trayFailed(tray, itemKey, errorMessage(err)));
    },
  );
}

/** Puts prepared picks in the tray and starts their uploads; what to say about the first turned away, or null. */
function addPicks(slug: string, conversationId: string, trayKey: string, picked: TrayPick[]): string | null {
  const result = trayAdd(trayOf(trayKey), picked);
  setTray(trayKey, () => result.tray);
  release(picked.filter((p) => result.refusedKeys.includes(p.key)));
  for (const item of result.added) upload(slug, conversationId, trayKey, item.key);
  return result.refused;
}

/**
 * Picks photos for the tray of `trayKey` (the composer's draft key), prepares them and starts uploading each to the
 * conversation. Resolves to what to say about a photo turned away (the limit, a type or size the message can't take, one
 * that couldn't be read), or null.
 */
export async function addPhotosToTray(slug: string, conversationId: string, trayKey: string): Promise<string | null> {
  const tray = trayOf(trayKey);
  if (trayFull(tray)) return CHAT_ATTACHMENT_LIMIT_TEXT;
  const started = session;
  const { picks: picked, problem } = await pickPhotos(trayRoom(tray));
  if (started !== session) {
    release(picked);
    return null;
  }
  const refused = picked.length ? addPicks(slug, conversationId, trayKey, picked) : null;
  return refused ?? problem;
}

/** Picks PDFs for the tray and starts uploading each, as addPhotosToTray does photos. */
export async function addFilesToTray(slug: string, conversationId: string, trayKey: string): Promise<string | null> {
  const tray = trayOf(trayKey);
  if (trayFull(tray)) return CHAT_ATTACHMENT_LIMIT_TEXT;
  const started = session;
  const files = await pickChatFiles({ limit: trayRoom(tray) });
  const picked = files.map((f): TrayPick => {
    const key = pickKey();
    sources.set(key, f.file ? { file: f.file } : { uri: f.uri, name: f.name, type: f.type });
    if (!f.file && f.uri) pickedFiles.add(f.uri);
    return { key, type: f.type, size: f.size, name: f.name };
  });
  if (started !== session) {
    release(picked);
    return null;
  }
  return picked.length ? addPicks(slug, conversationId, trayKey, picked) : null;
}

/** Takes an item out, cancelling its upload and letting its files go. Gives the tile to focus next (null: the attach button). */
export function removeFromTray(trayKey: string, itemKey: string): string | null {
  const result = trayRemove(trayOf(trayKey), itemKey);
  setTray(trayKey, () => result.tray);
  if (result.removed) {
    cancelUpload(itemKey);
    dropSource(itemKey);
    letGo(result.removed.previewUri);
  }
  return result.focusKey;
}

/** Uploads a failed item again, from the file prepared or picked the first time. */
export function retryTrayItem(slug: string, conversationId: string, trayKey: string, itemKey: string) {
  if (!sources.has(itemKey)) return;
  cancelUpload(itemKey);
  setTray(trayKey, (tray) => trayRetry(tray, itemKey));
  upload(slug, conversationId, trayKey, itemKey);
}

/**
 * Empties the tray into a send: what's uploaded, with each photo's preview, which the outbox entry now holds until it's
 * released (releaseOutboxAttachments). Anything not uploaded, which Send waits for, is let go.
 */
export function takeTray(trayKey: string): OutboxAttachment[] {
  const tray = trayOf(trayKey);
  if (tray.length === 0) return [];
  for (const item of tray) {
    if (item.status === "ready") sources.delete(item.key);
    else {
      cancelUpload(item.key);
      dropSource(item.key);
      letGo(item.previewUri);
    }
  }
  setTray(trayKey, () => []);
  return trayAttachments(tray);
}

/** A send's attachments back in the composer, as when it was refused for going too fast and its words go back in the box. */
export function restoreTray(trayKey: string, attachments: readonly OutboxAttachment[]) {
  if (attachments.length) setTray(trayKey, (tray) => [...tray, ...trayFromAttachments(attachments)]);
}

/**
 * The chat sync's onOutboxRelease: an entry has left the outbox (its message arrived, or it was discarded), so its photos'
 * previews can go. A sent one's are kept a minute more for the bubble of the message that arrived (sentPreviewOf), then
 * deleted; a discarded one's, which nothing will show, are deleted at once.
 */
export function releaseOutboxAttachments(entry: OutboxEntry, { sent }: { sent: boolean }) {
  for (const a of entry.attachments ?? []) {
    const uri = a.previewUri;
    if (!uri || !(previews.has(uri) || preparedPhotos.has(uri))) continue;
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
 * A thread the member can't reach any more (they left its group): its tray emptied, cancelling the uploads and deleting
 * their files, the prepared photos its unsent messages held deleted, and its links dropped. Call it before the thread's
 * outbox is removed.
 */
export function forgetThreadAttachments(qc: QueryClient, slug: string, conversationId: string, trayKey: string) {
  for (const item of trayOf(trayKey)) removeFromTray(trayKey, item.key);
  for (const entry of qc.getQueryData<OutboxEntry[]>(chatKeys.outbox(slug, conversationId)) ?? []) releaseOutboxAttachments(entry, { sent: false });
  qc.removeQueries({ queryKey: chatKeys.attachments(slug, conversationId) });
}

/**
 * Signing out (or any end of the session): every upload stops, every prepared photo and picked file is deleted, the photos
 * shown are dropped from expo-image's memory and the file last opened from the cache, with the trays the store forgets.
 * When someone was signed in (`signedOut`, not a cold start reading the session back), expo-image's disk cache is emptied
 * too: chat photos are drawn with cachePolicy memory or none, never as a placeholder, which expo-image keeps on disk
 * whatever the policy, so it should hold none of them, and this makes sure.
 */
export function forgetChatAttachments({ signedOut = true }: { signedOut?: boolean } = {}) {
  session += 1;
  for (const cancel of uploads.values()) cancel();
  uploads.clear();
  sources.clear();
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
  sentPreviews.clear();
  for (const uri of previews) URL.revokeObjectURL(uri);
  previews.clear();
  for (const uri of preparedPhotos) discardPreparedPhoto(uri);
  preparedPhotos.clear();
  for (const uri of pickedFiles) discardPickedFile(uri);
  pickedFiles.clear();
  forgetOpenedFiles();
  void Image.clearMemoryCache().catch(() => undefined);
  if (signedOut) void Image.clearDiskCache().catch(() => undefined);
}

const linkLoader = createAttachmentLinkLoader((slug, conversationId, messageIds) => api.chat.attachmentLinks(slug, conversationId, messageIds));

/**
 * One message's signed links, fetched with every other message that asks at the same moment: the messages a thread draws
 * together (its list draws only those near the screen) make one request. In memory only: used while fresh, dropped once
 * they'd be stale, and gone at sign-out with the rest of "chat".
 */
export const attachmentLinksQuery = (slug: string, conversationId: string, messageId: string) =>
  queryOptions({
    queryKey: chatKeys.attachmentLinks(slug, conversationId, [messageId]),
    queryFn: () => linkLoader.load(slug, conversationId, messageId),
    staleTime: CHAT_ATTACHMENT_LINK_FRESH_MS,
    gcTime: CHAT_ATTACHMENT_LINK_FRESH_MS,
  });

/** One attachment's links, fetched again first unless they're fresh: what opening and sharing go by. */
export async function freshAttachmentLink(qc: QueryClient, slug: string, conversationId: string, messageId: string, attachmentId: string): Promise<ChatAttachmentLinkDto> {
  const data = await qc.fetchQuery(attachmentLinksQuery(slug, conversationId, messageId));
  const link = data.links.find((l) => l.id === attachmentId);
  if (!link) throw new Error(CHAT_ATTACHMENT_UNAVAILABLE_TEXT);
  return link;
}

const PHOTO_EXTENSIONS: Readonly<Record<string, string>> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/**
 * Opens one of a message's files or photos from fresh links: on a phone, downloaded and handed to the share sheet; on the
 * web build, downloaded (openPrivateFile). A photo goes under a plain name, a file under its own. Throws with words for the
 * member when it can't.
 */
export async function openAttachment(qc: QueryClient, slug: string, conversationId: string, messageId: string, attachment: ChatAttachmentDto): Promise<void> {
  const link = await freshAttachmentLink(qc, slug, conversationId, messageId, attachment.id);
  const name = attachment.kind === "FILE" ? (attachment.name ?? CHAT_FILE_DEFAULT_NAME) : `photo.${PHOTO_EXTENSIONS[attachment.contentType] ?? "jpg"}`;
  await openPrivateFile(link.downloadUrl, name, attachment.contentType);
}
