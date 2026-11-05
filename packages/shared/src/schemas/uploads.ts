import { z } from "zod";
import { ALLOWED_IMAGE_MIME, MAX_UPLOAD_BYTES, UPLOAD_PURPOSES } from "../constants";

export const uploadQuerySchema = z.object({
  purpose: z.enum(UPLOAD_PURPOSES).default("image"),
});
export type UploadQuery = z.infer<typeof uploadQuerySchema>;

/** What the apps say about a file that isn't a photo the server takes. */
export const IMAGE_TYPE_PROBLEM = "Choose a JPEG, PNG or WebP image.";
/** What the apps, and the server for a body over the limit, say about a file that is too big. */
export const IMAGE_SIZE_PROBLEM = `Choose an image under ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.`;

/**
 * What stops a picked file from being uploaded, in words for the member, or null when it can go. The apps check before
 * sending so a wrong file fails at once rather than after a slow upload; the server checks again. An unknown size passes.
 */
export function imageFileProblem(file: { type?: string | null; size?: number | null }): string | null {
  if (!file.type || !(ALLOWED_IMAGE_MIME as readonly string[]).includes(file.type)) return IMAGE_TYPE_PROBLEM;
  if (file.size && file.size > MAX_UPLOAD_BYTES) return IMAGE_SIZE_PROBLEM;
  return null;
}
