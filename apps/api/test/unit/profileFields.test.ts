import {
  archiveFieldConfirm,
  CHOICE_TYPES,
  emptyFieldDraft,
  fieldBadges,
  fieldCanFilter,
  FILTERABLE_TYPES,
  formatProfileFieldValue,
  inFieldOrder,
  MAX_PROFILE_FIELDS,
  moveId,
  normalizeFieldBody,
  PROFILE_FIELD_TYPES,
  PROFILE_FIELD_VISIBILITIES,
  profileFieldConsistencyIssues,
  profileFieldCreateSchema,
  profileFieldFormErrors,
  profileFieldKeySchema,
  profileFieldsSubtitle,
  slugifyKey,
  uniqueOptionValue,
  validateProfileFieldValue,
  validateProfileFieldValues,
  type ProfileFieldDef,
  type ProfileFieldDraft,
} from "@illuminize/shared";
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

const draft = (over: Partial<ProfileFieldDraft> = {}): ProfileFieldDraft => ({ ...emptyFieldDraft(), key: "chapter", label: "Chapter", ...over });
const surat = { value: "surat", label: "Surat" };

describe("the field editor's helpers", () => {
  it("make a key from a question, as the API's key rule wants it", () => {
    expect(slugifyKey("Blood group")).toBe("blood_group");
    expect(slugifyKey("  Seva team 12345678 ")).toBe("seva_team_12345678");
    expect(slugifyKey("2nd year")).toBe("f_2nd_year");
    expect(slugifyKey("x".repeat(60))).toBe("x".repeat(40));
    expect(slugifyKey("!!!")).toBe("");
    for (const label of ["Blood group", "2nd year", "Roll No. (old)", "x".repeat(60)]) expect(profileFieldKeySchema.safeParse(slugifyKey(label)).success, label).toBe(true);
  });

  it("give a new option a value no other option has", () => {
    expect(uniqueOptionValue([], "Surat")).toBe("surat");
    expect(uniqueOptionValue([surat], "Surat")).toBe("surat_");
    expect(uniqueOptionValue([surat, { value: "surat_", label: "Surat" }], "surat")).toBe("surat__");
    expect(uniqueOptionValue([], "!!!")).toBe("option");
  });

  it("let a field filter the directory only as a choice or yes/no that members see", () => {
    for (const type of PROFILE_FIELD_TYPES) {
      for (const visibility of PROFILE_FIELD_VISIBILITIES) {
        expect(fieldCanFilter(type, visibility), `${type} ${visibility}`).toBe(["SELECT", "MULTI_SELECT", "BOOLEAN"].includes(type) && visibility === "MEMBERS");
      }
    }
    expect([...CHOICE_TYPES]).toEqual(["SELECT", "MULTI_SELECT"]);
    expect([...FILTERABLE_TYPES]).toEqual(["SELECT", "MULTI_SELECT", "BOOLEAN"]);
  });

  it("start a new field as short text members answer, and an edit from the field", () => {
    expect(emptyFieldDraft()).toEqual({ key: "", label: "", helpText: null, type: "TEXT", options: [], required: false, visibility: "MEMBERS", memberEditable: true, filterable: false });
    expect(emptyFieldDraft(null)).toEqual(emptyFieldDraft());
    const field = { id: "f1", key: "chapter", label: "Chapter", helpText: "Your city", type: "SELECT" as const, options: [surat], required: true, visibility: "ADMINS" as const, memberEditable: false, filterable: true, position: 1, archivedAt: null };
    expect(emptyFieldDraft(field)).toEqual({ key: "chapter", label: "Chapter", helpText: "Your city", type: "SELECT", options: [surat], required: true, visibility: "ADMINS", memberEditable: false, filterable: true });
  });

  it("send options only for a choice, a filter only where it can be one, and no blank help text", () => {
    expect(normalizeFieldBody(draft({ type: "TEXT", options: [surat], filterable: true }))).toMatchObject({ options: [], filterable: false });
    // Admin-only answers can't be filters: the directory ignores them, so the flag would only mislead.
    expect(normalizeFieldBody(draft({ type: "SELECT", options: [surat], visibility: "ADMINS", filterable: true }))).toMatchObject({ options: [surat], filterable: false });
    expect(normalizeFieldBody(draft({ type: "SELECT", options: [surat], visibility: "MEMBERS", filterable: true }))).toMatchObject({ options: [surat], filterable: true });
    expect(normalizeFieldBody(draft({ type: "BOOLEAN", filterable: true }))).toMatchObject({ options: [], filterable: true });
    expect(normalizeFieldBody(draft({ helpText: "   " })).helpText).toBeNull();
    expect(normalizeFieldBody(draft({ helpText: "Your city" })).helpText).toBe("Your city");
  });

  it("send only what the API's consistency rules accept, whatever was left ticked underneath", () => {
    for (const type of PROFILE_FIELD_TYPES) {
      for (const visibility of PROFILE_FIELD_VISIBILITIES) {
        const body = normalizeFieldBody(draft({ type, visibility, options: [surat], filterable: true }));
        expect(profileFieldConsistencyIssues(body), `${type} ${visibility}`).toEqual([]);
      }
    }
  });

  it("move an id one place, and nothing past either end", () => {
    const ids = ["a", "b", "c"];
    expect(moveId(ids, 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveId(ids, 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveId(ids, 1, 1)).toEqual(["a", "c", "b"]);
    expect(moveId(ids, 2, -1)).toEqual(["a", "c", "b"]);
    expect(moveId(ids, 0, -1)).toEqual(ids);
    expect(moveId(ids, 2, 1)).toEqual(ids);
    expect(moveId(ids, 5, -1)).toEqual(ids);
    expect(ids).toEqual(["a", "b", "c"]);
  });

  it("show a move at once in the order the API stores it: the listed fields, then the rest as they were", () => {
    const row = (id: string, archived = false) => ({ id, archivedAt: archived ? "2026-01-01T00:00:00Z" : null });
    const names = (rows: { id: string }[]) => rows.map((r) => r.id).join();
    expect(names(inFieldOrder([row("a"), row("b"), row("c")], ["a", "c", "b"]))).toBe("a,c,b");
    // Show archived: the archived ones (never in a move) go after the active ones, keeping their order, as stored.
    const rows = [row("a"), row("x", true), row("b"), row("y", true), row("c")];
    expect(names(inFieldOrder(rows, moveId(["a", "b", "c"], 2, -1)))).toBe("a,c,b,x,y");
    // A field added by someone else meanwhile isn't in the move: it goes after the listed ones.
    expect(names(inFieldOrder([row("new"), row("a"), row("b")], ["b", "a"]))).toBe("b,a,new");
    // The list given isn't changed.
    expect(names(rows)).toBe("a,x,b,y,c");
  });

  it("badge a field by its type, then what's special about it, in order", () => {
    const badges = (over: Partial<ProfileFieldDraft> & { archivedAt?: string | null }) => fieldBadges({ ...draft(over), archivedAt: over.archivedAt ?? null }).map((b) => `${b.label}:${b.tone}`);
    expect(badges({})).toEqual(["Short text:neutral"]);
    expect(badges({ type: "SELECT", required: true, visibility: "MEMBERS", memberEditable: false, filterable: true, archivedAt: "2026-01-01T00:00:00Z" })).toEqual([
      "Choose one:neutral",
      "Required:warning",
      "Set by admins:info",
      "Directory filter:success",
      "Archived:danger",
    ]);
    // A filter flag stored on an admin-only field filters nothing, so it isn't badged.
    expect(badges({ type: "SELECT", visibility: "ADMINS", filterable: true })).toEqual(["Choose one:neutral", "Admins only:info"]);
  });

  it("say how many questions are in use, and ask before archiving one", () => {
    expect(profileFieldsSubtitle(2)).toBe(`Your own questions on member profiles, such as house, roll number or hostel (2 of ${MAX_PROFILE_FIELDS}).`);
    expect(archiveFieldConfirm("Chapter")).toMatchObject({ title: "Archive “Chapter”?", confirmLabel: "Archive" });
  });
});

describe("profileFieldFormErrors", () => {
  it("finds nothing wrong with a body the API takes", () => {
    const body = normalizeFieldBody(draft({ type: "SELECT", options: [surat], filterable: true }));
    expect(profileFieldCreateSchema.safeParse(body).success).toBe(true);
    expect(profileFieldFormErrors(body, true)).toEqual({});
    expect(profileFieldFormErrors(body, false)).toEqual({});
  });

  it("says what's wrong by the input it's about, before anything is sent", () => {
    expect(Object.keys(profileFieldFormErrors(draft({ key: "1bad" }), true))).toEqual(["key"]);
    expect(profileFieldFormErrors(draft({ type: "SELECT", options: [] }), true)).toEqual({ options: "Add at least one option" });
    expect(profileFieldFormErrors(draft({ type: "SELECT", options: [] }), false)).toEqual({ options: "Add at least one option" });
    // A blank option label is the options' problem, not "options.0.label".
    expect(Object.keys(profileFieldFormErrors(draft({ type: "SELECT", options: [{ value: "a", label: "  " }] }), true))).toEqual(["options"]);
    expect(Object.keys(profileFieldFormErrors(draft({ label: " " }), false))).toEqual(["label"]);
  });

  it("doesn't check the key of an edit, which isn't sent", () => {
    expect(profileFieldFormErrors(draft({ key: "" }), false)).toEqual({});
    expect(Object.keys(profileFieldFormErrors(draft({ key: "" }), true))).toEqual(["key"]);
  });
});
