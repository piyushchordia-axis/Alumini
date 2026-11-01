import { createHmac, timingSafeEqual } from "node:crypto";

export const hmacSha256Hex = (secret: string, data: string | Buffer) => createHmac("sha256", secret).update(data).digest("hex");

/** Constant-time comparison of two hex signatures (false for any length mismatch). */
export function signaturesMatch(expectedHex: string, givenHex: string): boolean {
  const a = Buffer.from(expectedHex, "utf8");
  const b = Buffer.from(givenHex, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
