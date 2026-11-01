export interface StoredFile {
  /** Absolute public URL saved with the content (avatars, post images, logos). */
  url: string;
  /** Provider key, `<tenantId>/<uuid>.<ext>`. */
  key: string;
}

export interface StorageProvider {
  readonly name: string;
  save(input: { tenantId: string; buffer: Buffer; mime: string; extension: string }): Promise<StoredFile>;
  /** Removes a stored file; deleting a missing file is not an error. */
  delete(key: string): Promise<void>;
  /** The key for a URL this provider issued, or null for any other URL (e.g. one saved before a provider switch). */
  keyFromUrl(url: string): string | null;
}

/** Keys are always `<uuid>/<uuid>.<ext>`; anything else is rejected (no path traversal, no foreign objects). */
export const STORAGE_KEY_PATTERN = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/;
