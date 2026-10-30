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

  it("masks phone numbers", () => {
    expect(maskPhone("+919876543210")).toBe("+91*******210");
  });
});
