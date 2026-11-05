import { ALLOWED_IMAGE_MIME, BACKDROP_MAX_SIDE, MAX_IMAGE_SIDE, MAX_UPLOAD_BYTES, UPLOAD_JPEG_QUALITY, type UploadPurpose } from "../constants";
import { imageFileProblem } from "../schemas/uploads";

/** How long an upload may take before the apps give up on it and say so. */
export const UPLOAD_TIMEOUT_MS = 90_000;
export const UPLOAD_TIMEOUT_MESSAGE = "The upload is taking too long. Check your connection and try again.";

/** What an upload rejects with when the member cancelled it: nothing to report. */
export class UploadCancelledError extends Error {
  constructor() {
    super("Upload cancelled");
    this.name = "UploadCancelledError";
  }
}

export function isUploadCancelled(err: unknown): err is UploadCancelledError {
  return err instanceof UploadCancelledError;
}

/**
 * Starts an upload that the member can cancel and that gives up after `timeoutMs`. `run` gets the signal to pass to the
 * request. A cancelled upload rejects with UploadCancelledError, one that timed out with UPLOAD_TIMEOUT_MESSAGE; a
 * photo the server stored anyway is never saved to a profile and is swept away later.
 */
export function startUpload<T>(run: (signal: AbortSignal) => Promise<T>, timeoutMs = UPLOAD_TIMEOUT_MS): { promise: Promise<T>; cancel: () => void } {
  const controller = new AbortController();
  let reason: "cancelled" | "timeout" | null = null;
  const timer = setTimeout(() => {
    reason = "timeout";
    controller.abort();
  }, timeoutMs);
  const promise = run(controller.signal)
    .catch((err: unknown) => {
      if (reason === "cancelled") throw new UploadCancelledError();
      if (reason === "timeout") throw new Error(UPLOAD_TIMEOUT_MESSAGE);
      throw err;
    })
    .finally(() => clearTimeout(timer));
  return {
    promise,
    cancel: () => {
      reason ??= "cancelled";
      controller.abort();
    },
  };
}

/** Longest side, in pixels, a profile photo is prepared to before it is uploaded; the server crops it to 512 anyway. */
export const PHOTO_UPLOAD_MAX_SIDE = 1024;

/**
 * How a photo is prepared for each kind of upload. `maxSide`: the longest side it is sent at. `flatten`: the browser
 * always makes a JPEG on white of it, since the server keeps no transparency for it. `reencodeFromBytes`: saved again from
 * this size even when it already fits, because it is only ever shown small.
 */
const PREPARE: Record<UploadPurpose, { maxSide: number; flatten: boolean; reencodeFromBytes?: number }> = {
  avatar: { maxSide: PHOTO_UPLOAD_MAX_SIDE, flatten: true, reencodeFromBytes: 512 * 1024 },
  image: { maxSide: MAX_IMAGE_SIDE, flatten: false },
  // The server stores a background as a JPEG on white of at most this size, so nothing larger is worth sending.
  backdrop: { maxSide: BACKDROP_MAX_SIDE, flatten: true },
};

/**
 * Types whose photos never have see-through pixels. Anything else (PNG, WebP, GIF, AVIF, or a type nobody gave) may, so
 * it is kept as a PNG: a phone writing a JPEG of a transparent bitmap turns the see-through parts black.
 */
const OPAQUE_TYPES: ReadonlySet<string> = new Set(["image/jpeg", "image/jpg", "image/pjpeg", "image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"]);

/**
 * The size that fits `width` × `height` within `maxSide` on its longest side, keeping its shape and never enlarging;
 * 0 × 0 when a side is unknown.
 */
export function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
  if (!(width > 0 && height > 0)) return { width: 0, height: 0 };
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** What is known about a picked photo. A picker's or browser's figures describe the source, not what will be sent. */
export interface PhotoSource {
  type?: string | null;
  size?: number | null;
  width?: number | null;
  height?: number | null;
}

export interface PhotoUploadPlan {
  /** Whether the photo has to be decoded and saved again before it can go. */
  reencode: boolean;
  /** The longest side it may be sent at. */
  maxSide: number;
  /** Its size once fitted within maxSide; 0 × 0 while the source's size is unknown. */
  width: number;
  height: number;
  /** The source may have see-through pixels (any type but JPEG and HEIC or HEIF), so it is saved as a PNG to keep them. */
  keepsAlpha: boolean;
}

/**
 * How to turn a picked photo into one the server takes (JPEG, or PNG to keep transparency) at a size quick to send. It
 * has to be saved again when its type isn't one the server takes (HEIC), it is over the upload limit or larger than the
 * purpose allows, or, for a profile photo, it is big enough to be worth shrinking. `always` saves it again whatever it
 * looks like, for a phone, whose picker can label a HEIF photo image/jpeg.
 */
export function photoUploadPlan(source: PhotoSource, purpose: UploadPurpose, { always = false }: { always?: boolean } = {}): PhotoUploadPlan {
  const rules = PREPARE[purpose];
  const type = source.type ?? "";
  const size = source.size ?? 0;
  const width = source.width ?? 0;
  const height = source.height ?? 0;
  const reencode =
    always ||
    !(ALLOWED_IMAGE_MIME as readonly string[]).includes(type) ||
    Math.max(width, height) > rules.maxSide ||
    size > MAX_UPLOAD_BYTES ||
    (rules.reencodeFromBytes !== undefined && size >= rules.reencodeFromBytes);
  return { reencode, maxSide: rules.maxSide, ...fitWithin(width, height, rules.maxSide), keepsAlpha: !OPAQUE_TYPES.has(type.toLowerCase()) };
}

interface Bitmap {
  width: number;
  height: number;
  close(): void;
}
interface BrowserImaging {
  createImageBitmap?: (image: Blob, options: { imageOrientation: "from-image" }) => Promise<Bitmap>;
  document?: {
    createElement(tag: "canvas"): {
      width: number;
      height: number;
      getContext(kind: "2d"): { fillStyle: string; fillRect(x: number, y: number, w: number, h: number): void; drawImage(image: Bitmap, x: number, y: number, w: number, h: number): void } | null;
      toBlob(done: (blob: Blob | null) => void, type: string, quality: number): void;
    };
  };
}

/**
 * In a browser, turns a picked photo into one the server takes before it is uploaded (see photoUploadPlan): upright, at
 * most the purpose's longest side, and a JPEG on white, or a PNG that keeps the transparency of a source that may have
 * some and isn't a profile or background photo (a JPEG on white after all if that PNG would be over the upload limit).
 * A browser that can decode HEIC (Safari) makes a JPEG of one. A phone camera's 6 MB photo becomes a few hundred
 * kilobytes: under the limit, and quick on a slow connection. Every file is decoded, however small, since only that gives
 * its sides: a 300 KB PNG can be 9000 pixels wide, over the server's 40 megapixels. Gives back the file as it was when it
 * is an allowed photo that needs nothing, when the browser can't decode it (imageFileProblem then says why), or when the
 * result isn't smaller and the file can go as it is.
 */
export async function prepareImageFile(file: File, { purpose = "image" }: { purpose?: UploadPurpose } = {}): Promise<File> {
  // The browser's own types are not in every app's build (the API's has none), so the little used here is spelled out.
  const browser = globalThis as unknown as BrowserImaging;
  const document = browser.document;
  const acceptable = imageFileProblem(file) === null;
  if (typeof browser.createImageBitmap !== "function" || !document) return file;
  let bitmap: Bitmap | null = null;
  try {
    const image = await browser.createImageBitmap(file, { imageOrientation: "from-image" });
    bitmap = image;
    const plan = photoUploadPlan({ type: file.type, size: file.size, width: image.width, height: image.height }, purpose);
    if (!plan.reencode) return file;
    const { width, height } = plan;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext("2d");
    if (!g) return file;
    const encode = (type: "image/jpeg" | "image/png") => {
      if (type === "image/jpeg") {
        g.fillStyle = "#ffffff";
        g.fillRect(0, 0, width, height);
      }
      g.drawImage(image, 0, 0, width, height);
      return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, UPLOAD_JPEG_QUALITY));
    };
    let type: "image/jpeg" | "image/png" = plan.keepsAlpha && !PREPARE[purpose].flatten ? "image/png" : "image/jpeg";
    let blob = await encode(type);
    if (type === "image/png" && blob && blob.size > MAX_UPLOAD_BYTES) {
      // The white fill covers the PNG drawn before it.
      type = "image/jpeg";
      blob = await encode(type);
    }
    const canGoAsItIs = acceptable && Math.max(image.width, image.height) <= plan.maxSide;
    if (!blob || (blob.size >= file.size && canGoAsItIs)) return file;
    return new File([blob], `${file.name.replace(/\.[^.]*$/, "") || "photo"}.${type === "image/png" ? "png" : "jpg"}`, { type });
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}
