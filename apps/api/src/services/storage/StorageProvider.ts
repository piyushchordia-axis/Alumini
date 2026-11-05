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

/**
 * The key in `url` after `prefix`, the provider's public address for its files, or null. The address is matched as the
 * provider handed it out (on the base URL as configured) and also as a URL parser writes it (`URL.href`: a lower-case
 * host, no default port, an IDN host in punycode), because a link a member saves through `linkUrlSchema` is stored that
 * way. Without that, a base URL such as `https://CDN.example.com:443` would make the member's own uploads unrecognisable.
 */
export function keyAfterPrefix(url: string, prefix: string): string | null {
  for (const [address, start] of [
    [url, prefix],
    [canonicalUrl(url), canonicalUrl(prefix)],
  ]) {
    if (!address || !start || !address.startsWith(start)) continue;
    const key = address.slice(start.length);
    if (STORAGE_KEY_PATTERN.test(key)) return key;
  }
  return null;
}

function canonicalUrl(value: string): string | null {
  try {
    return new URL(value).href;
  } catch {
    return null;
  }
}
