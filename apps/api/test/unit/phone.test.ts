import { phoneEntryToE164, readPhoneEntry } from "@illuminize/shared";
import { describe, expect, it } from "vitest";
import { AppError } from "../../src/lib/errors";
import { maskPhone, normalizePhone } from "../../src/lib/phone";

describe("normalizePhone", () => {
  it("keeps E.164 input and detects the region", () => {
    expect(normalizePhone("+919876543210")).toEqual({ e164: "+919876543210", region: "IN" });
    expect(normalizePhone("+14155552671")).toEqual({ e164: "+14155552671", region: "US" });
    expect(normalizePhone("+971501234567").e164).toBe("+971501234567");
  });

  it("assumes India for national numbers and strips formatting", () => {
    expect(normalizePhone("98765 43210").e164).toBe("+919876543210");
    expect(normalizePhone("098765-43210").e164).toBe("+919876543210");
    expect(normalizePhone("(415) 555-2671", "US").e164).toBe("+14155552671");
  });

  it("rejects garbage", () => {
    expect(() => normalizePhone("12")).toThrow(AppError);
    expect(() => normalizePhone("hello")).toThrow(AppError);
    expect(() => normalizePhone("+1")).toThrow(AppError);
  });

  it("rejects India national numbers longer than 10 digits", () => {
    expect(() => normalizePhone("+9198765432101")).toThrow(AppError);
    expect(() => normalizePhone("98765432101")).toThrow(AppError);
  });

  it("still accepts nine-digit Indian numbers, which the demo seed and e2e sign in with", () => {
    expect(normalizePhone("+91931000006")).toEqual({ e164: "+91931000006", region: "IN" });
    expect(normalizePhone("931000006").e164).toBe("+91931000006");
  });

  it("gets the right number from what the apps' phone fields send for each pasted or autofilled form", () => {
    for (const raw of ["+919876543210", "+91 98765 43210", "919876543210", "09876543210", "0091 98765 43210"]) {
      expect(normalizePhone(phoneEntryToE164(readPhoneEntry("IN", raw))).e164, raw).toBe("+919876543210");
    }
  });

  it("accepts a German mobile at its allowed national length", () => {
    expect(normalizePhone("+4915123456789")).toEqual({ e164: "+4915123456789", region: "DE" });
  });

  it("masks phone numbers", () => {
    expect(maskPhone("+919876543210")).toBe("+91*******210");
  });
});
