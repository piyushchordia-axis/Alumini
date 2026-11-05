import { createHmac } from "node:crypto";
import type { Config } from "../config/env";
import { isAppError } from "./errors";
import { normalizePhone } from "./phone";

type HashConfig = Pick<Config, "JWT_SECRET" | "PHONE_HASH_KEY">;

const STORED_E164 = /^\+[1-9]\d{1,14}$/;

/** PHONE_HASH_KEY, or else a key derived from JWT_SECRET, as unsubscribe links derive theirs, so no new secret is needed. */
function hashKey(config: HashConfig): string | Buffer {
  return config.PHONE_HASH_KEY ?? createHmac("sha256", config.JWT_SECRET).update("illuminize/phone-hash/v1").digest();
}

/**
 * The number as normalizePhone writes it. A number already stored in E.164 that today's rules refuse (a country's lengths
 * regenerated, or libphonenumber updated since it signed in) is taken as stored, so deleting that account or joining with
 * it never fails on its own number. Nothing typed today can normalise to it, so no match is lost.
 */
function canonicalPhone(phone: string): string {
  try {
    return normalizePhone(phone).e164;
  } catch (err) {
    if (isAppError(err) && STORED_E164.test(phone)) return phone;
    throw err;
  }
}

/**
 * A keyed HMAC-SHA256 (hex) of a phone number, which is all a deleted account leaves behind to match a rejoining number
 * to the sanctions it held (deletedAccounts.repo). Taken over the normalised E.164, so the number written another way
 * still matches. Changing the key (or JWT_SECRET, while it stands in for one) loses every match silently.
 */
export function phoneHash(config: HashConfig, phone: string): string {
  return createHmac("sha256", hashKey(config)).update(canonicalPhone(phone)).digest("hex");
}
