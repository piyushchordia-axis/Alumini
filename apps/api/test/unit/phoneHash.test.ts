import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/env";
import { AppError } from "../../src/lib/errors";
import { phoneHash } from "../../src/lib/phoneHash";

const JWT_SECRET = "j".repeat(40);
const KEY = "k".repeat(40);

describe("phoneHash", () => {
  it("is a stable HMAC-SHA256 in hex that never shows the number", () => {
    const hash = phoneHash({ JWT_SECRET, PHONE_HASH_KEY: KEY }, "+919876543210");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(createHmac("sha256", KEY).update("+919876543210").digest("hex"));
    expect(phoneHash({ JWT_SECRET, PHONE_HASH_KEY: KEY }, "+919876543210")).toBe(hash);
    for (const digits of ["9876543210", "98765", "43210"]) expect(hash).not.toContain(digits);
  });

  it("hashes the normalised number, so the same number written another way matches", () => {
    const config = { JWT_SECRET, PHONE_HASH_KEY: KEY };
    const hash = phoneHash(config, "+919876543210");
    for (const written of ["+91 98765 43210", "98765 43210", "098765-43210", "(+91) 98765-43210"]) expect(phoneHash(config, written), written).toBe(hash);
    expect(phoneHash(config, "+919876543211")).not.toBe(hash);
    expect(() => phoneHash(config, "12")).toThrow(AppError);
  });

  it("hashes a stored E.164 number that today's rules refuse as it is, rather than failing on it", () => {
    const config = { JWT_SECRET, PHONE_HASH_KEY: KEY };
    // Twelve national digits: India allows ten now, but a number stored under older rules keeps its account deletable.
    const stored = "+91987654321012";
    expect(phoneHash(config, stored)).toBe(createHmac("sha256", KEY).update(stored).digest("hex"));
    // Only a stored E.164 string: typed input that doesn't normalise is still refused.
    for (const typed of ["987654321012", "+91 98765 4321012", "+0123"]) expect(() => phoneHash(config, typed), typed).toThrow(AppError);
  });

  it("depends on the key, and without PHONE_HASH_KEY uses one derived from JWT_SECRET, never JWT_SECRET itself", () => {
    const phone = "+919876543210";
    expect(phoneHash({ JWT_SECRET, PHONE_HASH_KEY: "z".repeat(40) }, phone)).not.toBe(phoneHash({ JWT_SECRET, PHONE_HASH_KEY: KEY }, phone));
    const fallback = phoneHash({ JWT_SECRET, PHONE_HASH_KEY: undefined }, phone);
    const derived = createHmac("sha256", JWT_SECRET).update("illuminize/phone-hash/v1").digest();
    expect(fallback).toBe(createHmac("sha256", derived).update(phone).digest("hex"));
    expect(fallback).not.toBe(createHmac("sha256", JWT_SECRET).update(phone).digest("hex"));
    expect(fallback).not.toBe(phoneHash({ JWT_SECRET, PHONE_HASH_KEY: KEY }, phone));
    expect(phoneHash({ JWT_SECRET: "x".repeat(40), PHONE_HASH_KEY: undefined }, phone)).not.toBe(fallback);
  });

  it("refuses a PHONE_HASH_KEY under 32 characters", () => {
    const dev = { NODE_ENV: "development", DATABASE_URL: "postgres://x", JWT_SECRET, OTP_PEPPER: "p".repeat(20) };
    expect(() => loadConfig({ ...dev, PHONE_HASH_KEY: "short" })).toThrow(/PHONE_HASH_KEY must be at least 32 characters/);
    expect(loadConfig({ ...dev, PHONE_HASH_KEY: KEY }).PHONE_HASH_KEY).toBe(KEY);
    expect(loadConfig({ ...dev, PHONE_HASH_KEY: "" }).PHONE_HASH_KEY).toBeUndefined();
  });
});
