import { createHmac, timingSafeEqual } from "node:crypto";
import type { Config } from "../config/env";

/**
 * Which copy of a chat attachment a link opens: the photo or the file as it is shown (`full`), a photo's thumbnail
 * (`thumb`), or a download (`download`), which a photo answers under a generic name.
 */
export const FILE_LINK_VARIANTS = ["full", "thumb", "download"] as const;
export type FileLinkVariant = (typeof FILE_LINK_VARIANTS)[number];

export interface FileLinkClaim {
  attachmentId: string;
  variant: FileLinkVariant;
  /** Unix seconds. */
  expiresAt: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** FILE_URL_KEY, or else a key derived from JWT_SECRET, as phone hashes and unsubscribe links derive theirs. */
export function fileLinkKey(config: Pick<Config, "JWT_SECRET" | "FILE_URL_KEY">): string | Buffer {
  return config.FILE_URL_KEY ?? createHmac("sha256", config.JWT_SECRET).update("illuminize/file-links/v1").digest();
}

const mac = (key: string | Buffer, payload: string) => createHmac("sha256", key).update(payload).digest("base64url");

/**
 * A token for one copy of one attachment until `expiresAt`: the base64url of `{a, v, e}` and its HMAC. It holds the
 * attachment's id and nothing about the file, so a link in a log or a browser's history says nothing about it, and the
 * file is looked up again on every use.
 */
export function signFileLink(key: string | Buffer, claim: FileLinkClaim): string {
  const payload = Buffer.from(JSON.stringify({ a: claim.attachmentId, v: claim.variant, e: claim.expiresAt })).toString("base64url");
  return `${payload}.${mac(key, payload)}`;
}

/** The claim a token makes, or null when it isn't one of ours, was changed, or has expired. */
export function verifyFileLink(key: string | Buffer, token: string, nowMs = Date.now()): FileLinkClaim | null {
  const [payload, sig, ...rest] = token.split(".");
  if (!payload || !sig || rest.length > 0) return null;
  const expected = Buffer.from(mac(key, payload));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let body: unknown;
  try {
    body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const { a, v, e } = (body ?? {}) as { a?: unknown; v?: unknown; e?: unknown };
  if (typeof a !== "string" || !UUID_RE.test(a)) return null;
  if (typeof v !== "string" || !(FILE_LINK_VARIANTS as readonly string[]).includes(v)) return null;
  if (typeof e !== "number" || !Number.isInteger(e) || e * 1000 <= nowMs) return null;
  return { attachmentId: a, variant: v as FileLinkVariant, expiresAt: e };
}
