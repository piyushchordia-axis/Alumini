import { createHmac, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fileLinkKey, signFileLink, verifyFileLink, type FileLinkClaim } from "../../src/lib/fileLinks";

const KEY = "k".repeat(40);
const NOW = Date.UTC(2026, 10, 7, 10, 0, 0);
const inSeconds = (s: number) => Math.floor(NOW / 1000) + s;

/** A token with any payload, signed the way signFileLink signs, for claims it would never make. */
function signedPayload(body: unknown, key: string | Buffer = KEY): string {
  const payload = Buffer.from(JSON.stringify(body)).toString("base64url");
  return `${payload}.${createHmac("sha256", key).update(payload).digest("base64url")}`;
}

describe("file links", () => {
  const claim: FileLinkClaim = { attachmentId: randomUUID(), variant: "full", expiresAt: inSeconds(600) };

  it("verifies what it signed, until it expires", () => {
    const token = signFileLink(KEY, claim);
    expect(verifyFileLink(KEY, token, NOW)).toEqual(claim);
    for (const variant of ["thumb", "download"] as const) expect(verifyFileLink(KEY, signFileLink(KEY, { ...claim, variant }), NOW)?.variant).toBe(variant);
    expect(verifyFileLink(KEY, token, NOW + 599_000)).toEqual(claim);
    expect(verifyFileLink(KEY, token, NOW + 600_000)).toBeNull();
    expect(verifyFileLink(KEY, signFileLink(KEY, { ...claim, expiresAt: inSeconds(-1) }), NOW)).toBeNull();
  });

  it("holds the attachment's id, the copy and the expiry, and nothing about the file", () => {
    const token = signFileLink(KEY, claim);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    const [payload] = token.split(".");
    expect(JSON.parse(Buffer.from(payload!, "base64url").toString("utf8"))).toEqual({ a: claim.attachmentId, v: "full", e: claim.expiresAt });
  });

  it("refuses a changed token", () => {
    const token = signFileLink(KEY, claim);
    const [payload, sig] = token.split(".") as [string, string];
    const flipped = (s: string, at: number) => `${s.slice(0, at)}${s[at] === "A" ? "B" : "A"}${s.slice(at + 1)}`;
    expect(verifyFileLink(KEY, `${payload}.${flipped(sig, 0)}`, NOW)).toBeNull();
    expect(verifyFileLink(KEY, `${payload}.${flipped(sig, sig.length - 1)}`, NOW)).toBeNull();
    expect(verifyFileLink(KEY, `${flipped(payload, 3)}.${sig}`, NOW)).toBeNull();
    // A longer life, or another copy, under the same signature.
    const longer = Buffer.from(JSON.stringify({ a: claim.attachmentId, v: "full", e: inSeconds(86_400) })).toString("base64url");
    expect(verifyFileLink(KEY, `${longer}.${sig}`, NOW)).toBeNull();
    const download = Buffer.from(JSON.stringify({ a: claim.attachmentId, v: "download", e: claim.expiresAt })).toString("base64url");
    expect(verifyFileLink(KEY, `${download}.${sig}`, NOW)).toBeNull();
    for (const broken of ["", ".", payload, `${payload}.`, `.${sig}`, `${token}.x`, sig.slice(0, 20), `${payload}.${sig.slice(0, -1)}`]) {
      expect(verifyFileLink(KEY, broken, NOW), broken).toBeNull();
    }
  });

  it("opens only the attachment it was signed for", () => {
    const other = randomUUID();
    const [, sig] = signFileLink(KEY, claim).split(".");
    const otherPayload = Buffer.from(JSON.stringify({ a: other, v: "full", e: claim.expiresAt })).toString("base64url");
    expect(verifyFileLink(KEY, `${otherPayload}.${sig}`, NOW)).toBeNull();
    expect(verifyFileLink(KEY, signFileLink(KEY, { ...claim, attachmentId: other }), NOW)?.attachmentId).toBe(other);
  });

  it("refuses a token signed with another key", () => {
    expect(verifyFileLink("o".repeat(40), signFileLink(KEY, claim), NOW)).toBeNull();
  });

  it("refuses a well-signed token whose claim isn't one it makes", () => {
    const e = claim.expiresAt;
    for (const body of [
      { a: "not-a-uuid", v: "full", e },
      { a: claim.attachmentId.toUpperCase(), v: "full", e },
      { a: claim.attachmentId, v: "original", e },
      { a: claim.attachmentId, v: "full", e: String(e) },
      { a: claim.attachmentId, v: "full", e: e + 0.5 },
      { a: claim.attachmentId, v: "full" },
      null,
      [claim.attachmentId, "full", e],
    ]) {
      expect(verifyFileLink(KEY, signedPayload(body), NOW), JSON.stringify(body)).toBeNull();
    }
    const notJson = Buffer.from("{nope").toString("base64url");
    expect(verifyFileLink(KEY, `${notJson}.${createHmac("sha256", KEY).update(notJson).digest("base64url")}`, NOW)).toBeNull();
  });

  it("signs with FILE_URL_KEY, or else a key of its own derived from JWT_SECRET", () => {
    const jwt = "j".repeat(48);
    const derived = fileLinkKey({ JWT_SECRET: jwt, FILE_URL_KEY: undefined });
    expect(derived).not.toEqual(jwt);
    expect(fileLinkKey({ JWT_SECRET: jwt, FILE_URL_KEY: undefined })).toEqual(derived);
    expect(fileLinkKey({ JWT_SECRET: jwt, FILE_URL_KEY: KEY })).toBe(KEY);
    const token = signFileLink(derived, claim);
    expect(verifyFileLink(fileLinkKey({ JWT_SECRET: "x".repeat(48), FILE_URL_KEY: undefined }), token, NOW)).toBeNull();
    expect(verifyFileLink(jwt, token, NOW)).toBeNull();
    expect(verifyFileLink(derived, token, NOW)).toEqual(claim);
  });
});
