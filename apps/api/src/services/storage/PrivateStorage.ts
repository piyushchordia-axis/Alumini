import { contentDisposition } from "../../lib/contentDisposition";
import type { FileLinkVariant } from "../../lib/fileLinks";
import { THUMBNAIL_MIME } from "../../lib/images";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** Keys are `<tenantId>/<uuid>.<ext>` of the four kinds kept, and nothing else: no key can reach outside the private area. */
export const PRIVATE_KEY_PATTERN = new RegExp(`^${UUID}/${UUID}\\.(jpg|png|webp|pdf)$`);

/** What private storage holds, by the type the bytes showed, and the extension each is saved with. */
export const PRIVATE_EXTENSIONS = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" } as const;
export type PrivateMime = keyof typeof PRIVATE_EXTENSIONS;

export interface PrivateSaveInput {
  tenantId: string;
  buffer: Buffer;
  mime: PrivateMime;
  /**
   * The name a PDF downloads under (the row's `file_name`); null for a photo or a thumbnail. S3 saves the object with the
   * disposition `privateFileDisposition` works out from it, as /files does from the row on local disk, so no caller
   * chooses one.
   */
  fileName: string | null;
}

export interface PrivateLinkInput {
  attachmentId: string;
  /** The object this copy reads: the file, or a photo's thumbnail. */
  key: string;
  variant: FileLinkVariant;
  /** The type of what `key` holds. */
  contentType: string;
  ttlSec: number;
}

/**
 * Where chat photos and files are kept: never public, and reached only through links that expire. Local disk signs its
 * own (/files/<token>); S3 presigns a GET. A link is a bearer capability until it expires, so callers check who may have
 * one every time they hand one out, and never store or log it.
 */
export interface PrivateStorage {
  readonly name: string;
  save(input: PrivateSaveInput): Promise<{ key: string }>;
  /** Removes a stored file; deleting a missing file is not an error. */
  delete(key: string): Promise<void>;
  link(input: PrivateLinkInput): Promise<string>;
}

export function assertPrivateKey(key: string): void {
  if (!PRIVATE_KEY_PATTERN.test(key)) throw new Error("Refusing an invalid private storage key");
}

/** A photo's download carries no name of its own: a member's photos have none, and an S3 link would show one in its URL. */
function photoDownloadName(contentType: string): string {
  const extension = (PRIVATE_EXTENSIONS as Record<string, string>)[contentType] ?? "jpg";
  return `photo.${extension}`;
}

/** The only types a browser may show in place: the three photo formats. */
const INLINE_TYPES: ReadonlySet<string> = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * How a copy of an attachment is offered: a photo and its thumbnail open in place, a photo's download is a file named
 * "photo", and a PDF is always a download under its own name, never shown in the browser. Any other type, which nothing
 * should store, is a download too.
 */
export function privateFileDisposition(file: { contentType: string; fileName: string | null }, variant: FileLinkVariant): string {
  if (!INLINE_TYPES.has(file.contentType)) {
    // A name with nothing printable left in it downloads under a generic one, not the link's last segment.
    const named = contentDisposition("attachment", file.fileName);
    return named === "attachment" ? contentDisposition("attachment", file.contentType === "application/pdf" ? "Document.pdf" : "file") : named;
  }
  return variant === "download" ? contentDisposition("attachment", photoDownloadName(file.contentType)) : "inline";
}

/** Whether a link must ask for another disposition than the object was saved with, which only a photo's download does. */
export function linkDispositionOverride(variant: FileLinkVariant, contentType: string): string | null {
  return variant === "download" && INLINE_TYPES.has(contentType) ? privateFileDisposition({ contentType, fileName: null }, variant) : null;
}

export interface PrivateCopy {
  key: string;
  contentType: string;
  disposition: string;
}

/** The object, type and disposition one copy of an attachment answers with, or null when it has no such copy (a file's thumbnail). */
export function privateCopy(row: { storageKey: string; thumbKey: string | null; contentType: string; fileName: string | null }, variant: FileLinkVariant): PrivateCopy | null {
  if (variant === "thumb") return row.thumbKey ? { key: row.thumbKey, contentType: THUMBNAIL_MIME, disposition: "inline" } : null;
  return { key: row.storageKey, contentType: row.contentType, disposition: privateFileDisposition(row, variant) };
}
