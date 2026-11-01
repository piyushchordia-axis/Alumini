import { formatProfileFieldValue, validateProfileFieldValue, validateProfileFieldValues, type ProfileFieldDef } from "@illuminize/shared";
import { describe, expect, it } from "vitest";

const def = (over: Partial<ProfileFieldDef>): ProfileFieldDef => ({ key: "f", label: "F", type: "TEXT", options: [], required: false, visibility: "MEMBERS", memberEditable: true, ...over });
const house = def({ key: "house", type: "SELECT", options: [{ value: "blue", label: "Blue House" }, { value: "red", label: "Red House" }] });
const sports = def({ key: "sports", type: "MULTI_SELECT", options: [{ value: "cricket", label: "Cricket" }, { value: "chess", label: "Chess" }] });

describe("profile field values", () => {
  it("validates each type and treats empty input as no answer", () => {
    expect(validateProfileFieldValue(def({ type: "TEXT" }), "  hi  ")).toEqual({ ok: true, value: "hi" });
    expect(validateProfileFieldValue(def({ type: "TEXT" }), "x".repeat(201)).ok).toBe(false);
    expect(validateProfileFieldValue(def({ type: "LONG_TEXT" }), "x".repeat(2000)).ok).toBe(true);
    expect(validateProfileFieldValue(def({ type: "NUMBER" }), "42")).toEqual({ ok: true, value: 42 });
    expect(validateProfileFieldValue(def({ type: "NUMBER" }), "4x").ok).toBe(false);
    expect(validateProfileFieldValue(def({ type: "DATE" }), "2026-02-29").ok).toBe(false);
    expect(validateProfileFieldValue(def({ type: "DATE" }), "2024-02-29")).toEqual({ ok: true, value: "2024-02-29" });
    expect(validateProfileFieldValue(def({ type: "BOOLEAN" }), "false")).toEqual({ ok: true, value: false });
    expect(validateProfileFieldValue(house, "green").ok).toBe(false);
    expect(validateProfileFieldValue(sports, ["chess", "chess", "cricket"])).toEqual({ ok: true, value: ["chess", "cricket"] });
    expect(validateProfileFieldValue(sports, ["golf"]).ok).toBe(false);
    for (const empty of [null, undefined, "", "  ", []]) expect(validateProfileFieldValue(house, empty)).toEqual({ ok: true, value: null });
  });

  it("keeps a removed option valid for the member who already chose it", () => {
    expect(validateProfileFieldValue(house, "green", "green")).toEqual({ ok: true, value: "green" });
    expect(validateProfileFieldValue(sports, ["golf", "chess"], ["golf"])).toEqual({ ok: true, value: ["golf", "chess"] });
  });

  it("requires required answers at registration, refuses clearing them later, and respects who may edit", () => {
    const req = def({ key: "roll", required: true });
    const adminOnly = def({ key: "verified", type: "BOOLEAN", memberEditable: false });
    const canEdit = (d: ProfileFieldDef) => d.memberEditable;
    expect(validateProfileFieldValues([req, house], {}, { requireAll: true, canEdit }).errors).toEqual({ roll: "This is required" });
    expect(validateProfileFieldValues([req, house], { house: "red" }, { requireAll: false, canEdit }).errors).toEqual({});
    expect(validateProfileFieldValues([req], { roll: "" }, { requireAll: false }).errors).toEqual({ roll: "This is required" });
    expect(validateProfileFieldValues([adminOnly], { verified: true }, { requireAll: false, canEdit }).errors).toEqual({ verified: "Only admins can change this" });
    // Posting back the unchanged value is fine.
    expect(validateProfileFieldValues([adminOnly], { verified: true }, { requireAll: false, canEdit, previous: { verified: true } }).errors).toEqual({});
    expect(validateProfileFieldValues([house], { nope: "x" }, { requireAll: false }).errors).toEqual({ nope: "Unknown field" });
  });

  it("formats answers for display", () => {
    expect(formatProfileFieldValue(house, "blue")).toBe("Blue House");
    expect(formatProfileFieldValue(sports, ["cricket", "golf"])).toBe("Cricket, golf");
    expect(formatProfileFieldValue(def({ type: "BOOLEAN" }), false)).toBe("No");
    expect(formatProfileFieldValue(def({ type: "NUMBER" }), 7)).toBe("7");
  });
});
