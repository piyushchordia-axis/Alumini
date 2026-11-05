import { MAX_UPLOAD_BYTES, UPLOAD_JPEG_QUALITY, type UploadPurpose } from "@illuminize/shared";
import { photoUploadPlan } from "@illuminize/shared/client";
import { File as FsFile, Paths } from "expo-file-system";
import { ImageManipulator, SaveFormat, type ImageRef } from "expo-image-manipulator";
import type { ImagePickerAsset } from "expo-image-picker";

/** A photo ready to upload from the phone: a file in the app's cache, and what it really is. */
export interface PreparedPhoto {
  uri: string;
  name: string;
  type: "image/jpeg" | "image/png";
  size: number;
}

/** How much each side shrinks each time a PNG comes out over the upload limit: about half the pixels. */
const PNG_SHRINK = 0.7;
const PNG_SHRINK_TRIES = 3;

/**
 * Turns a picked photo into one the server takes: decoded (HEIC and HEIF too), upright, at most the purpose's longest
 * side, and saved as a JPEG, or as a PNG when the source may be see-through (anything but a JPEG, HEIC or HEIF; the
 * server puts a profile photo on white). A phone paints nothing under a JPEG, so a transparent bitmap saved as one turns
 * black: a PNG over the upload limit is drawn smaller instead, keeping its see-through parts. The picker's type, size
 * and dimensions describe the source, not this file, so every pick is saved again (an Android picker can label a HEIF
 * photo image/jpeg) and the size is read from the file written. The copy carries no EXIF or GPS position. Throws when the
 * photo can't be read.
 */
export async function preparePickedPhoto(asset: Pick<ImagePickerAsset, "uri" | "mimeType" | "fileSize" | "width" | "height">, purpose: UploadPurpose): Promise<PreparedPhoto> {
  const plan = photoUploadPlan({ type: asset.mimeType, size: asset.fileSize, width: asset.width, height: asset.height }, purpose, { always: true });
  // Bounding the decode itself keeps a 50-megapixel photo from being held in memory at full size; it needs no known size.
  const context = ImageManipulator.manipulate(asset.uri, { maxWidth: plan.maxSide, maxHeight: plan.maxSide });
  let image: ImageRef | null = null;
  try {
    image = await context.renderAsync();
    if (!plan.keepsAlpha) return await save(image, "jpeg");
    let photo = await save(image, "png");
    let side = Math.max(image.width, image.height);
    for (let tries = 0; photo.size > MAX_UPLOAD_BYTES && tries < PNG_SHRINK_TRIES; tries++) {
      discardPreparedPhoto(photo.uri);
      side = Math.max(1, Math.round(side * PNG_SHRINK));
      photo = await saveSmaller(image, side);
    }
    // Still over the limit after that (hardly possible), it is refused before it goes, in the usual words.
    return photo;
  } finally {
    image?.release();
    context.release();
  }
}

async function save(image: ImageRef, format: "jpeg" | "png"): Promise<PreparedPhoto> {
  const saved = await image.saveAsync({ format: format === "png" ? SaveFormat.PNG : SaveFormat.JPEG, compress: UPLOAD_JPEG_QUALITY });
  return {
    uri: saved.uri,
    name: format === "png" ? "photo.png" : "photo.jpg",
    type: format === "png" ? "image/png" : "image/jpeg",
    size: new FsFile(saved.uri).size,
  };
}

/** Saves the photo again as a PNG of at most `side` pixels on its longest side. */
async function saveSmaller(image: ImageRef, side: number): Promise<PreparedPhoto> {
  const context = ImageManipulator.manipulate(image, { maxWidth: side, maxHeight: side });
  let smaller: ImageRef | null = null;
  try {
    smaller = await context.renderAsync();
    return await save(smaller, "png");
  } finally {
    smaller?.release();
    context.release();
  }
}

/** Deletes a prepared copy once it has gone up, or was given up on. Best effort: the system clears the cache anyway. */
export function discardPreparedPhoto(uri: string) {
  try {
    new FsFile(uri).delete();
  } catch {
    // Already gone.
  }
}

/**
 * Deletes the picker's own copy of a photo once it has been prepared or given up on. The picker copies every pick into
 * the app's cache, at full size when picked at quality 1, and the system clears that only when storage runs low. Only a
 * file in the app's cache is ever deleted, never one in the photo library.
 */
export function discardPickedPhoto(uri: string) {
  try {
    const cache = Paths.cache.uri;
    if (!cache || !uri.startsWith(cache.endsWith("/") ? cache : `${cache}/`)) return;
    new FsFile(uri).delete();
  } catch {
    // Already gone, or not ours to delete.
  }
}
