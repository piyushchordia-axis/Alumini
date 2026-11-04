import { AVATAR_SIZE, MAX_UPLOAD_BYTES, type UploadPurpose } from "@illuminize/shared";
import sharp, { type Metadata, type Sharp } from "sharp";
import { AppError } from "./errors";

export type ImageMime = "image/jpeg" | "image/png" | "image/webp";

export const IMAGE_EXTENSIONS: Record<ImageMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Longest side of a stored image; larger ones are scaled down, smaller ones left as they are. */
export const MAX_IMAGE_SIDE = 2048;
/** Refuses anything larger before decoding it, so a small file that unpacks to a huge bitmap can't exhaust memory. */
export const MAX_INPUT_PIXELS = 40_000_000;
/**
 * The most memory one decoded image may take: MAX_INPUT_PIXELS of 8-bit RGBA. Pixels alone undercount a 16-bit or
 * many-channel image, which can need twice as much or more, so those get proportionally fewer pixels.
 */
export const MAX_DECODED_BYTES = MAX_INPUT_PIXELS * 4;
/**
 * Images processed at once by this process. Each can hold a decoded bitmap of up to MAX_DECODED_BYTES and runs on one
 * of libuv's four threads, which files on disk and DNS lookups share, so more uploads at once wait their turn instead.
 */
export const IMAGE_CONCURRENCY = 2;

// Uploads are one-off, so libvips' operation cache would only hold memory.
sharp.cache(false);

/** Detects the real image type from magic bytes (client-supplied MIME types are not trusted). */
export function sniffImageType(buf: Buffer): ImageMime | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

const BYTES_PER_SAMPLE: Record<Metadata["depth"], number> = {
  char: 1,
  uchar: 1,
  short: 2,
  ushort: 2,
  int: 4,
  uint: 4,
  float: 4,
  complex: 8,
  double: 8,
  dpcomplex: 16,
};

/** Memory the decoded image takes, from its header. */
export function decodedImageBytes(meta: Pick<Metadata, "width" | "height" | "channels" | "depth">): number {
  return meta.width * meta.height * meta.channels * (BYTES_PER_SAMPLE[meta.depth] ?? 4);
}

/** Runs at most `max` of the functions given to it at once; the others wait, first come first served. */
export function concurrencyLimit(max: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async (fn) => {
    if (active < max) active++;
    // A finishing call hands its slot straight to the next in line, so `active` stays as it is.
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      return await fn();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}

const imageSlot = concurrencyLimit(IMAGE_CONCURRENCY);

export interface ProcessedImage {
  buffer: Buffer;
  mime: ImageMime;
  width: number;
  height: number;
}

const tooLarge = (message: string) => new AppError(413, "PAYLOAD_TOO_LARGE", message);

/**
 * Re-encodes an upload so what is stored is only pixels: turned upright from its EXIF orientation, with every bit of
 * metadata (GPS position, camera, EXIF) dropped, which is sharp's default output. Images keep their format and are
 * scaled to at most MAX_IMAGE_SIDE; an avatar becomes an AVATAR_SIZE square JPEG cropped around the most interesting
 * part, with any transparency on white. A file that doesn't decode is 415. One with too many pixels, one too big to
 * decode, or one whose result would still be over `maxBytes` (a file that compresses far better than its resized
 * pixels can) is 413.
 */
export function processImage(input: Buffer, mime: ImageMime, purpose: UploadPurpose, { maxBytes = MAX_UPLOAD_BYTES }: { maxBytes?: number } = {}): Promise<ProcessedImage> {
  return imageSlot(async () => {
    try {
      // failOn "error" still accepts a slightly damaged photo (a truncated JPEG decodes with a warning).
      const open = () => sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" });
      // The header alone: cheap, and refused by limitInputPixels before anything is decoded.
      const meta = await open().metadata();
      if (meta.width * meta.height > MAX_INPUT_PIXELS) throw tooLarge(`The image is too large. Use one under ${MAX_INPUT_PIXELS / 1_000_000} megapixels.`);
      if (decodedImageBytes(meta) > MAX_DECODED_BYTES) throw tooLarge("The image is too large to process. Use a smaller one, or save it with 8 bits per channel.");
      const { width, height } = meta.autoOrient;
      const result =
        purpose === "avatar"
          ? await encodeFirstThatFits(await avatarPipeline(open, width, height), [(s) => s.jpeg({ quality: 82, mozjpeg: true })], maxBytes)
          : await encodeFirstThatFits(open().autoOrient().resize(MAX_IMAGE_SIDE, MAX_IMAGE_SIDE, { fit: "inside", withoutEnlargement: true }), ENCODERS[mime], maxBytes);
      if (!result) throw tooLarge("The image is too large once processed. Use a smaller or simpler one.");
      return { ...result, mime: purpose === "avatar" ? "image/jpeg" : mime };
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (err instanceof Error && /pixel limit/i.test(err.message)) throw tooLarge(`The image is too large. Use one under ${MAX_INPUT_PIXELS / 1_000_000} megapixels.`);
      throw new AppError(415, "UNSUPPORTED_MEDIA", "The file could not be read as an image");
    }
  });
}

/** Each format's encodings, tried in order until one fits: the usual one, then a smaller one that loses a little. */
const ENCODERS: Record<ImageMime, Array<(s: Sharp) => Sharp>> = {
  "image/jpeg": [(s) => s.jpeg({ quality: 85 }), (s) => s.jpeg({ quality: 70 })],
  "image/png": [(s) => s.png(), (s) => s.png({ palette: true })],
  "image/webp": [(s) => s.webp({ quality: 85 }), (s) => s.webp({ quality: 70 })],
};

async function encodeFirstThatFits(image: Sharp, encoders: Array<(s: Sharp) => Sharp>, maxBytes: number): Promise<Omit<ProcessedImage, "mime"> | null> {
  for (const encode of encoders) {
    const { data, info } = await encode(image.clone()).toBuffer({ resolveWithObject: true });
    if (data.length <= maxBytes) return { buffer: data, width: info.width, height: info.height };
  }
  return null;
}

/**
 * The avatar square, on white. Cropping first and enlarging only the square keeps the work bounded by the input's own
 * pixels: "cover" on a tiny, very narrow image (1×8000) would otherwise enlarge all of it until its short side is
 * AVATAR_SIZE, a strip of millions of pixels the attention crop then reads.
 */
async function avatarPipeline(open: () => Sharp, width: number, height: number): Promise<Sharp> {
  const side = Math.min(width, height);
  if (side >= AVATAR_SIZE) {
    // Only ever scaled down, so the crop reads no more pixels than the input has.
    return open().autoOrient().resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover", position: "attention" }).flatten({ background: "#ffffff" });
  }
  // Too small for the square: crop it at the image's own size (no scaling), then enlarge that square alone.
  const square = await open().autoOrient().resize(side, side, { fit: "cover", position: "attention" }).raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels } = square.info;
  return sharp(square.data, { raw: { width: w, height: h, channels } }).resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "fill" }).flatten({ background: "#ffffff" });
}
