import { UPLOAD_TIMEOUT_MS } from "../client/imageUpload";
import { ALLOWED_IMAGE_MIME, CHAT_ATTACHMENT_LINK_TTL_SEC, CHAT_ATTACHMENTS_PER_MESSAGE, CHAT_FILE_MAX_BYTES, CHAT_FILE_NAME_MAX_LENGTH, CHAT_FILE_TYPES, type ChatAttachmentKind, type TenantFeatures } from "../constants";
import { CHAT_ATTACHMENT_LIMIT_TEXT, CHAT_ATTACHMENT_TYPE_PROBLEM, CHAT_FILE_SIZE_PROBLEM, VISIBLE_CHARACTER } from "../schemas/chat";
import { imageFileProblem } from "../schemas/uploads";
import type { ChatAttachmentDto, ChatAttachmentSummaryDto, ChatConversationDto } from "../types/dto";
import type { OutboxAttachment } from "./cache";

/**
 * Photos and PDFs in chat, the same on both apps: what may be picked, how a file's name and size read, what a preview and a
 * screen reader say, how a message lays its photos out, and the tray of picks waiting to be sent.
 */

type PickedFile = { type?: string | null; size?: number | null; name?: string | null };

// A picker that can't tell (some Android providers) says nothing or octet-stream; the name decides, and the server the bytes.
const UNTYPED = new Set(["", "application/octet-stream"]);

function isPdf(file: PickedFile): boolean {
  const type = (file.type ?? "").toLowerCase();
  if ((CHAT_FILE_TYPES as readonly string[]).includes(type)) return true;
  return UNTYPED.has(type) && /\.pdf$/i.test(file.name ?? "");
}

/** What a picked file would be in a message, or null when it can't go in one. */
export function chatAttachmentKindOf(file: PickedFile): ChatAttachmentKind | null {
  if ((ALLOWED_IMAGE_MIME as readonly string[]).includes(file.type ?? "")) return "PHOTO";
  return isPdf(file) ? "FILE" : null;
}

/**
 * What stops a picked file going into a message, in words for the member, or null when it can go: a photo by the rules of
 * any upload (imageFileProblem, which names the photo types for a HEIC or other image the server can't read), a PDF under
 * CHAT_FILE_MAX_BYTES, and nothing else. Checked on a photo once it's prepared. An unknown size passes; the server checks
 * again by the bytes.
 */
export function chatAttachmentProblem(file: PickedFile): string | null {
  if (isPdf(file)) return file.size && file.size > CHAT_FILE_MAX_BYTES ? CHAT_FILE_SIZE_PROBLEM : null;
  if ((file.type ?? "").toLowerCase().startsWith("image/")) return imageFileProblem(file);
  return CHAT_ATTACHMENT_TYPE_PROBLEM;
}

/** What a file is called when nothing of its own name is left to use. */
export const CHAT_FILE_DEFAULT_NAME = "Document.pdf";

// Control characters, what Windows or macOS refuse in a file name, and invisible characters, among them those that make a
// name read backwards ("invoice\u202Efdp.exe" shows as "invoiceexe.pdf").
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const UNSAFE_NAME_CHARACTERS = /[\u0000-\u001F\u007F-\u009F\\/:*?"<>|\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;
const EXTENSION = ".pdf";

function nfc(text: string): string {
  try {
    return text.normalize("NFC");
  } catch {
    // A JavaScript engine without normalisation keeps the name as given; the server cleans it again.
    return text;
  }
}

/**
 * A file's name as kept and shown: NFC, with nothing that could hide part of it or reach outside a folder, no leading dots,
 * one space for any run of white space, and ".pdf" at the end, within CHAT_FILE_NAME_MAX_LENGTH (never splitting a
 * character). CHAT_FILE_DEFAULT_NAME when nothing is left.
 */
export function chatFileName(raw: string | null | undefined): string {
  const cleaned = nfc(raw ?? "")
    .replace(UNSAFE_NAME_CHARACTERS, "")
    .replace(/\s+/g, " ")
    .trim();
  let stem = cleaned
    .replace(/\.pdf$/i, "")
    .replace(/^[.\s]+/, "")
    .replace(/[.\s]+$/, "");
  if (!stem) return CHAT_FILE_DEFAULT_NAME;
  const room = CHAT_FILE_NAME_MAX_LENGTH - EXTENSION.length;
  if (stem.length > room) {
    let cut = "";
    for (const ch of stem) {
      if (cut.length + ch.length > room) break;
      cut += ch;
    }
    stem = cut.replace(/[.\s]+$/, "") || CHAT_FILE_DEFAULT_NAME.slice(0, -EXTENSION.length);
  }
  return `${stem}${EXTENSION}`;
}

const KB = 1024;
const MB = 1024 * 1024;

/** "820 bytes", "48 KB", "1.2 MB", "10 MB": by hand, since the phone's Hermes may lack Intl's units. */
export function formatFileSize(bytes: number): string {
  if (bytes < KB) return bytes === 1 ? "1 byte" : `${Math.max(0, Math.round(bytes))} bytes`;
  const kb = Math.round(bytes / KB);
  if (kb < 1024) return `${kb} KB`;
  const mb = bytes / MB;
  const shown = mb < 10 ? (Math.round(mb * 10) / 10).toFixed(1).replace(/\.0$/, "") : String(Math.round(mb));
  return `${shown} MB`;
}

const TYPE_LABELS: Readonly<Record<string, string>> = { "application/pdf": "PDF", "image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WebP" };

/** What a type is called beside a file's size. */
export const fileTypeLabel = (contentType: string): string => TYPE_LABELS[contentType] ?? "File";

/** The grey line under a file's name: "PDF · 1.2 MB". */
export const fileMetaText = (a: Pick<ChatAttachmentDto, "contentType" | "size">): string => `${fileTypeLabel(a.contentType)} · ${formatFileSize(a.size)}`;

/** A message's photos and files counted, as an inbox preview has them; null for none. */
export function attachmentSummary(attachments: ReadonlyArray<Pick<ChatAttachmentDto, "kind" | "name">>): ChatAttachmentSummaryDto | null {
  if (attachments.length === 0) return null;
  const files = attachments.filter((a) => a.kind === "FILE");
  return { photos: attachments.length - files.length, files: files.length, fileName: files[0]?.name ?? null };
}

/** What a preview says about the photos and files: "Photo", "3 photos", "File: notes.pdf", "2 files", "3 attachments"; "" for none. */
export function attachmentPreviewText(summary: ChatAttachmentSummaryDto | null | undefined): string {
  if (!summary) return "";
  const { photos, files } = summary;
  if (photos > 0 && files > 0) return `${photos + files} attachments`;
  if (photos === 1) return "Photo";
  if (photos > 1) return `${photos} photos`;
  if (files === 1) return `File: ${summary.fileName ?? CHAT_FILE_DEFAULT_NAME}`;
  if (files > 1) return `${files} files`;
  return "";
}

/** A message as an inbox row previews it: its words, its photos and files ("Photo"), or both ("Photo · See you there"). */
export function messagePreviewText(body: string, summary: ChatAttachmentSummaryDto | null | undefined): string {
  const lead = attachmentPreviewText(summary);
  if (!lead) return body;
  return VISIBLE_CHARACTER.test(body) ? `${lead} · ${body}` : lead;
}

/** What a screen reader hears for a message's photos and files, before its words: "Photo.", "2 photos and a file."; "" for none. */
export function attachmentA11yText(attachments: ReadonlyArray<Pick<ChatAttachmentDto, "kind">>): string {
  const files = attachments.filter((a) => a.kind === "FILE").length;
  const photos = attachments.length - files;
  if (photos + files === 0) return "";
  if (photos + files === 1) return photos ? "Photo." : "File.";
  const parts = [photos === 1 ? "a photo" : photos > 1 ? `${photos} photos` : null, files === 1 ? "a file" : files > 1 ? `${files} files` : null].filter(Boolean);
  const text = parts.join(" and ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

/** How wide a message's photos are drawn, in points or CSS pixels, and the gap between two. */
export const PHOTO_GRID_WIDTH = 260;
export const PHOTO_GRID_GAP = 4;
const PHOTO_MIN_HEIGHT = 120;
const PHOTO_MAX_HEIGHT = 320;
// A photo whose size isn't known (a pending one before it's read) is drawn as a landscape photo.
const UNKNOWN_RATIO = 3 / 4;

/**
 * The box a message's only photo is drawn in: the full width, as tall as its shape asks within 120 to 320, covered and
 * cropped beyond that. Known from the DTO before the photo loads, so a thread never jumps as photos arrive.
 */
export function photoBoxSize(width: number | null | undefined, height: number | null | undefined, maxWidth = PHOTO_GRID_WIDTH): { width: number; height: number } {
  const ratio = width && height && width > 0 && height > 0 ? height / width : UNKNOWN_RATIO;
  return { width: maxWidth, height: Math.min(PHOTO_MAX_HEIGHT, Math.max(PHOTO_MIN_HEIGHT, Math.round(maxWidth * ratio))) };
}

export interface PhotoCell {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PhotoGrid {
  width: number;
  height: number;
  /** One per photo, in order. */
  cells: PhotoCell[];
}

/**
 * Where each of a message's photos goes, so both apps place them alike: one photo by its shape (photoBoxSize), two as
 * squares side by side, then rows of two squares with an odd last photo across both columns (three: two above, one wide).
 */
export function photoGridLayout(photos: ReadonlyArray<Pick<ChatAttachmentDto, "width" | "height">>, maxWidth = PHOTO_GRID_WIDTH, gap = PHOTO_GRID_GAP): PhotoGrid {
  if (photos.length === 0) return { width: 0, height: 0, cells: [] };
  if (photos.length === 1) {
    const box = photoBoxSize(photos[0]!.width, photos[0]!.height, maxWidth);
    return { ...box, cells: [{ x: 0, y: 0, ...box }] };
  }
  const side = Math.floor((maxWidth - gap) / 2);
  const width = side * 2 + gap;
  const cells = photos.map((_, i) => {
    const wide = i === photos.length - 1 && photos.length % 2 === 1;
    return { x: wide ? 0 : (i % 2) * (side + gap), y: Math.floor(i / 2) * (side + gap), width: wide ? width : side, height: side };
  });
  const rows = Math.ceil(photos.length / 2);
  return { width, height: rows * side + (rows - 1) * gap, cells };
}

/** Where the composer's attach button would be, when it isn't there, for an institution with photos and files turned off. */
export const CHAT_ATTACHMENTS_OFF_CAPTION = "Photos and files are turned off for this institution.";

type AttachCaptionThread = Pick<ChatConversationDto, "group" | "state" | "canAttach">;

/**
 * The line under the box when a send can't carry photos and files, or null when it can (the attach button shows instead).
 * `c` is the thread, or null on the screen writing a first message, which never can; `name` is the other member's. With
 * the switch known to be off, that's what it says; otherwise a request (or asking again) waits for an answer, and an
 * accepted chat or a group that can send but not attach can only mean the switch. It reads the thread as its member sees
 * it, so a request waiting, declined or met by a block says the same.
 */
export function composerAttachCaption(c: AttachCaptionThread | null, features: Pick<TenantFeatures, "chatAttachments"> | null | undefined, name: string | null | undefined): string | null {
  if (c?.canAttach) return null;
  if (features && !features.chatAttachments) return CHAT_ATTACHMENTS_OFF_CAPTION;
  if (!c || (!c.group && (c.state === "REQUEST_SENT" || c.state === "CLOSED"))) return `Photos and files can be sent once ${name || "this member"} accepts.`;
  return CHAT_ATTACHMENTS_OFF_CAPTION;
}

// Fetch can't report an upload's progress, so its time limit assumes a slow connection: 50 KB a second.
const SLOW_UPLOAD_BYTES_PER_SEC = 50 * KB;

/** How long a chat upload may take before it's given up: what a slow connection needs for its size, and never under UPLOAD_TIMEOUT_MS. */
export function chatUploadTimeoutMs(bytes: number): number {
  return Math.max(UPLOAD_TIMEOUT_MS, Math.ceil((Math.max(0, bytes) / SLOW_UPLOAD_BYTES_PER_SEC) * 1000));
}

/** How long fetched links are used before fetching fresh ones: two minutes inside their CHAT_ATTACHMENT_LINK_TTL_SEC. */
export const CHAT_ATTACHMENT_LINK_FRESH_MS = (CHAT_ATTACHMENT_LINK_TTL_SEC - 120) * 1000;

/** Where a pick waiting in the composer stands: its upload under way, done, or failed and waiting to be tried again or removed. */
export type TrayStatus = "uploading" | "ready" | "failed";

/** A photo or PDF the member has added to the message they're writing. */
export interface TrayItem {
  /** The app's own key for it, which its upload (and cancelling it) goes by. */
  key: string;
  kind: ChatAttachmentKind;
  /** A file's cleaned name; null for a photo. */
  name: string | null;
  contentType: string;
  size: number;
  /** What a photo's tile shows: its prepared copy on the device (an object URL, or a file on the phone). Null for a file. */
  previewUri: string | null;
  width: number | null;
  height: number | null;
  status: TrayStatus;
  /** Why its upload failed, for the status line. */
  error: string | null;
  /** What the server made of it once uploaded; its id is what the send names. */
  attachment: ChatAttachmentDto | null;
}

/** What an app knows of a pick once it's prepared: its key, type, size and name, and a photo's preview and size in pixels. */
export interface TrayPick extends PickedFile {
  key: string;
  previewUri?: string | null;
  width?: number | null;
  height?: number | null;
}

export interface TrayAddResult {
  tray: TrayItem[];
  /** What to upload now, in order. */
  added: TrayItem[];
  /** What to say about the first pick turned away, or null when every one was taken. */
  refused: string | null;
  /** The picks turned away, whose prepared copies the app can let go. */
  refusedKeys: string[];
}

/** Whether the tray holds as many as a message may: the attach button stays, but says so (CHAT_ATTACHMENT_LIMIT_TEXT). */
export const trayFull = (tray: readonly TrayItem[]): boolean => tray.length >= CHAT_ATTACHMENTS_PER_MESSAGE;

/** How many more the tray takes, for a picker's own limit. */
export const trayRoom = (tray: readonly TrayItem[]): number => Math.max(0, CHAT_ATTACHMENTS_PER_MESSAGE - tray.length);

/**
 * Adds picks to the tray, each as uploading, in order, until it's full. A pick that can't go (chatAttachmentProblem) or
 * finds no room is turned away, and the first such reason is what the composer says.
 */
export function trayAdd(tray: readonly TrayItem[], picks: readonly TrayPick[]): TrayAddResult {
  const added: TrayItem[] = [];
  const refusedKeys: string[] = [];
  let refused: string | null = null;
  for (const pick of picks) {
    const problem = tray.length + added.length >= CHAT_ATTACHMENTS_PER_MESSAGE ? CHAT_ATTACHMENT_LIMIT_TEXT : chatAttachmentProblem(pick);
    const kind = chatAttachmentKindOf(pick);
    if (problem || !kind) {
      refused ??= problem ?? CHAT_ATTACHMENT_TYPE_PROBLEM;
      refusedKeys.push(pick.key);
      continue;
    }
    const photo = kind === "PHOTO";
    added.push({
      key: pick.key,
      kind,
      name: photo ? null : chatFileName(pick.name),
      contentType: photo ? pick.type! : CHAT_FILE_TYPES[0],
      size: pick.size ?? 0,
      previewUri: photo ? (pick.previewUri ?? null) : null,
      width: photo ? (pick.width ?? null) : null,
      height: photo ? (pick.height ?? null) : null,
      status: "uploading",
      error: null,
      attachment: null,
    });
  }
  return { tray: [...tray, ...added], added, refused, refusedKeys };
}

/** Changes one item; anything else, and a key that isn't there, as it was. */
export function trayUpdate(tray: readonly TrayItem[], key: string, patch: Partial<Omit<TrayItem, "key">>): TrayItem[] {
  return tray.map((item) => (item.key === key ? { ...item, ...patch } : item));
}

/** Its upload is done: what the send will name, with the size the server kept and a file's name as it cleaned it. */
export function trayReady(tray: readonly TrayItem[], key: string, attachment: ChatAttachmentDto): TrayItem[] {
  return tray.map((item) => (item.key === key ? { ...item, status: "ready" as const, error: null, attachment, size: attachment.size, name: item.kind === "FILE" ? (attachment.name ?? item.name) : null } : item));
}

export const trayFailed = (tray: readonly TrayItem[], key: string, error: string): TrayItem[] => trayUpdate(tray, key, { status: "failed", error, attachment: null });

/** Tried again: uploading once more, with nothing left of the failure. */
export const trayRetry = (tray: readonly TrayItem[], key: string): TrayItem[] => trayUpdate(tray, key, { status: "uploading", error: null, attachment: null });

/**
 * Takes one out. `removed` is what to let go (its upload to cancel, its preview), and `focusKey` the tile whose remove
 * button takes focus next, or null for the attach button when it was the last.
 */
export function trayRemove(tray: readonly TrayItem[], key: string): { tray: TrayItem[]; removed: TrayItem | null; focusKey: string | null } {
  const at = tray.findIndex((item) => item.key === key);
  if (at === -1) return { tray: [...tray], removed: null, focusKey: null };
  return { tray: tray.filter((_, i) => i !== at), removed: tray[at]!, focusKey: tray[at + 1]?.key ?? null };
}

/** What a tile is called: "Photo 2" by its place among the photos, or a file's name. */
export function trayItemName(tray: readonly TrayItem[], key: string): string {
  const item = tray.find((i) => i.key === key);
  if (!item) return "";
  if (item.kind === "FILE") return item.name ?? CHAT_FILE_DEFAULT_NAME;
  return `Photo ${tray.filter((i) => i.kind === "PHOTO").indexOf(item) + 1}`;
}

/** A tile's accessible names: its remove and try-again buttons, and the tile while it uploads. */
export function trayItemLabels(tray: readonly TrayItem[], key: string): { name: string; remove: string; retry: string; busy: string } {
  const item = tray.find((i) => i.key === key);
  const name = trayItemName(tray, key);
  const inSentence = item?.kind === "PHOTO" ? name.toLowerCase() : name;
  return { name, remove: `Remove ${inSentence}`, retry: `Try uploading ${inSentence} again`, busy: `Uploading ${inSentence}` };
}

/**
 * The composer's polite status line about the tray: a failed upload first, which needs the member, then what's still
 * uploading; "" when there's nothing to say.
 */
export function trayStatusText(tray: readonly TrayItem[]): string {
  const failed = tray.find((i) => i.status === "failed");
  if (failed) {
    const name = trayItemName(tray, failed.key);
    return failed.error ? `${name} wasn't uploaded: ${failed.error}` : `${name} wasn't uploaded.`;
  }
  const uploading = tray.filter((i) => i.status === "uploading");
  if (uploading.length === 0) return "";
  const photos = uploading.filter((i) => i.kind === "PHOTO").length;
  const n = uploading.length;
  const what = photos === n ? (n === 1 ? "photo" : "photos") : photos === 0 ? (n === 1 ? "file" : "files") : "attachments";
  return `Uploading ${n} ${what}…`;
}

/**
 * Whether Send goes: there are words or something uploaded, and nothing still uploading or failed. `reason` is what a
 * disabled Send says when it's the tray holding it back.
 */
export function traySendable(tray: readonly TrayItem[], text: string): { ok: boolean; reason: string | null } {
  if (tray.some((i) => i.status === "uploading")) return { ok: false, reason: "Wait for uploads to finish" };
  if (tray.some((i) => i.status === "failed")) return { ok: false, reason: "Remove or retry what didn't upload" };
  return { ok: VISIBLE_CHARACTER.test(text) || tray.some((i) => i.status === "ready"), reason: null };
}

/** What a send carries from the tray: the uploaded items, in order, with their previews for the bubble until it's confirmed. */
export function trayAttachments(tray: readonly TrayItem[]): OutboxAttachment[] {
  return tray.flatMap((item) => (item.status === "ready" && item.attachment ? [{ ...item.attachment, previewUri: item.previewUri }] : []));
}

/** A send's attachments back in the tray, uploaded, as when it was refused for going too fast and the words go back in the box. */
export function trayFromAttachments(attachments: readonly OutboxAttachment[]): TrayItem[] {
  return attachments.map(({ previewUri, ...attachment }) => ({
    key: attachment.id,
    kind: attachment.kind,
    name: attachment.name,
    contentType: attachment.contentType,
    size: attachment.size,
    previewUri,
    width: attachment.width,
    height: attachment.height,
    status: "ready",
    error: null,
    attachment,
  }));
}
