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

/** Longest side, in pixels, a profile photo is shrunk to in the browser before it is uploaded. */
export const PHOTO_UPLOAD_MAX_SIDE = 1024;
/** Photos smaller than this go up as they are. */
const SHRINK_FROM_BYTES = 512 * 1024;

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
 * In a browser, turns a large photo into a JPEG of at most PHOTO_UPLOAD_MAX_SIDE pixels (upright, transparency on white)
 * before it is uploaded as a profile photo, which the server crops to 512 pixels anyway. A phone camera's 6 MB photo
 * becomes a few hundred kilobytes: under the upload limit, and quick on a slow connection. Gives back the file as it
 * was when it is already small, or when the browser can't decode it (the server then decides).
 */
export async function shrinkPhoto(file: File): Promise<File> {
  // The browser's own types are not in every app's build (the API's has none), so the little used here is spelled out.
  const browser = globalThis as unknown as BrowserImaging;
  const document = browser.document;
  if (file.size < SHRINK_FROM_BYTES || typeof browser.createImageBitmap !== "function" || !document) return file;
  let bitmap: Bitmap | null = null;
  try {
    bitmap = await browser.createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, PHOTO_UPLOAD_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext("2d");
    if (!g) return file;
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, width, height);
    g.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], `${file.name.replace(/\.[^.]*$/, "") || "photo"}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}
