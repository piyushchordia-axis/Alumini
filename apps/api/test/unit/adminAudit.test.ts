import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AUDIT_ACTION_FILTERS, auditActorLabel, auditDetailLines, auditEmptyTitle, auditTargetLabel, isPrivateAuditKey, parseAuditAction } from "@illuminize/shared";
import { describe, expect, it } from "vitest";
import { phoneHash } from "../../src/lib/phoneHash";

const API_SRC = resolve(fileURLToPath(import.meta.url), "../../../src");
const ID = "3f2a9c1e-9c1d-4e5f-8a7b-0c1d2e3f4a5b";

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : path.endsWith(".ts") ? [readFileSync(path, "utf8")] : [];
  });
}

/** The action families the API records, read from its source: a literal ("membership.role_change") or a template. */
function recordedFamilies(api: string): Set<string> {
  return new Set([...api.matchAll(/action: *["`]([a-z_]+\.)/g), ...api.matchAll(/\(tenantId, (?:viewer|actor), "([a-z_]+\.)/g), ...api.matchAll(/audit\(ctx, [^,]+, actor, "([a-z_]+\.)/g)].map((m) => m[1]!));
}

/** The object literal that opens at `open`, braces balanced. */
function objectAt(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  return "";
}

/**
 * The keys the API writes into audit metadata, read from its source: each `metadata: { … }` or `metadata = { … }`, and
 * the metadata argument of the chat reports' auditEntry and the exports' audit helper. A key is a name before ":", or a
 * shorthand one before "," or "}"; a spread of a variable (`...counts`) isn't followed.
 */
function metadataKeys(api: string): Set<string> {
  const keys = new Set<string>();
  for (const m of api.matchAll(/(?:\bmetadata(?:: *| = )|\bauditEntry\(tenantId, [^{;]*?|\baudit\(ctx, [^{;]*?)\{/g)) {
    const literal = objectAt(api, m.index + m[0].length - 1);
    for (const k of literal.matchAll(/[{,]\s*([A-Za-z_$][\w$]*)\s*(?=[:,}])/g)) keys.add(k[1]!);
  }
  return keys;
}

/**
 * The metadata keys the audit log shows, each checked to hold nothing private: ids, counts, statuses and roles, what
 * changed (by name), an admin's reason or moderation note, and what a report is about. Message bodies and request notes
 * never go into metadata (CLAUDE.md), and a phone number given as a value is dropped under any key.
 */
const SHOWN_KEYS = new Set([
  ...["access", "action", "adminIds", "adminOf", "amountMinor", "attempted", "billingModel", "changes", "channels", "clearedDegrees"],
  ...["closedPlans", "contentId", "contentType", "conversationId", "count", "created", "customFields", "effectiveFrom", "fields"],
  ...["force", "forcedOff", "from", "heldSuspensions", "institutions", "invitationId", "job", "key", "membershipIds", "memberships"],
  ...["messageCount", "messageIds", "note", "period", "periodEnd", "periodStart", "reason", "reportId", "role", "rows", "scope"],
  ...["slug", "status", "suspendedAt", "targetId", "targetKind", "to", "type", "verificationId", "viaReportId"],
]);

/**
 * Families the API records that get no chip: sign-ins and an account's email are recorded with no institution, so are
 * never in its log, and a member's own email unsubscribe can be typed.
 */
const FAMILIES_WITHOUT_A_CHIP = new Set(["auth.", "user.", "notifications."]);

describe("AUDIT_ACTION_FILTERS", () => {
  it("are whole families of actions, each once, the dot included so membership. never takes in another family", () => {
    for (const { prefix } of AUDIT_ACTION_FILTERS) expect(prefix, prefix).toMatch(/^[a-z_]+\.$/);
    expect(new Set(AUDIT_ACTION_FILTERS.map((f) => f.prefix)).size).toBe(AUDIT_ACTION_FILTERS.length);
    expect(new Set(AUDIT_ACTION_FILTERS.map((f) => f.label)).size).toBe(AUDIT_ACTION_FILTERS.length);
  });

  it("each pick out actions the API records, read from its source, so a renamed family fails here rather than filter to nothing", () => {
    const recorded = recordedFamilies(sources(API_SRC).join("\n"));
    for (const { prefix } of AUDIT_ACTION_FILTERS) expect(recorded.has(prefix), `${prefix} among ${[...recorded].join(" ")}`).toBe(true);
  });

  it("cover every family the API records but those left out on purpose, so a new family gets a chip or a reason", () => {
    const recorded = recordedFamilies(sources(API_SRC).join("\n"));
    const chips = new Set(AUDIT_ACTION_FILTERS.map((f) => f.prefix));
    for (const family of recorded) expect(chips.has(family) || FAMILIES_WITHOUT_A_CHIP.has(family), `${family} has no chip`).toBe(true);
    for (const family of FAMILIES_WITHOUT_A_CHIP) {
      expect(recorded.has(family), `${family} is no longer recorded`).toBe(true);
      expect(chips.has(family), `${family} has a chip after all`).toBe(false);
    }
    // The requests between members are families of their own, which the Mentors chip's "mentor." doesn't take in.
    expect(chips.has("mentorship.") && chips.has("referral.")).toBe(true);
  });
});

describe("auditActorLabel", () => {
  it("names a member, says staff or the system for a user with no membership, and a dash for no actor", () => {
    expect(auditActorLabel({ actorName: "Jignesh Patel", actorUserId: ID })).toBe("Jignesh Patel");
    expect(auditActorLabel({ actorName: null, actorUserId: ID })).toBe("Platform / system");
    expect(auditActorLabel({ actorName: null, actorUserId: null })).toBe("—");
  });
});

describe("auditTargetLabel", () => {
  it("shortens the id to 8 characters, and gives a membership's id for a link to the member", () => {
    expect(auditTargetLabel({ targetType: "membership", targetId: ID })).toEqual({ text: "membership 3f2a9c1e", membershipId: ID });
    expect(auditTargetLabel({ targetType: "post", targetId: ID })).toEqual({ text: "post 3f2a9c1e" });
  });

  it("says a dash for no target, and links only an id that can go into a route", () => {
    expect(auditTargetLabel({ targetType: null, targetId: null })).toEqual({ text: "—" });
    expect(auditTargetLabel({ targetType: "tenant", targetId: null })).toEqual({ text: "tenant" });
    expect(auditTargetLabel({ targetType: "membership", targetId: "../settings" })).toEqual({ text: "membership ../setti" });
  });
});

describe("auditDetailLines", () => {
  it("reads a change of status as from → to, then the reason, then the rest as label and value", () => {
    expect(auditDetailLines({ from: "PENDING", to: "REJECTED", reason: "Not a Samaj member yet", role: "MEMBER" })).toEqual(["PENDING → REJECTED", "Reason: Not a Samaj member yet", "Role: MEMBER"]);
    expect(auditDetailLines({ role: "MEMBER", reason: "Spam", from: "APPROVED", to: "SUSPENDED" })).toEqual(["APPROVED → SUSPENDED", "Reason: Spam", "Role: MEMBER"]);
  });

  it("leaves out what is empty, and says nothing for no metadata", () => {
    expect(auditDetailLines({ from: "PENDING", to: "APPROVED", reason: null, note: "", fields: [] })).toEqual(["PENDING → APPROVED"]);
    expect(auditDetailLines({})).toEqual([]);
    expect(auditDetailLines(null)).toEqual([]);
  });

  it("joins a short list, counts a long one, and labels the keys that wouldn't say it themselves", () => {
    expect(auditDetailLines({ fields: ["fullName", "city"] })).toEqual(["Changed: fullName, city"]);
    const ids = Array.from({ length: 6 }, () => ID);
    expect(auditDetailLines({ count: 6, membershipIds: ids })).toEqual(["Count: 6", "Members: 6 items"]);
    expect(auditDetailLines({ heldSuspensions: 1, attempted: "membership.role_change", force: true })).toEqual(["Held suspensions: 1", "Attempted: membership.role_change", "Force: Yes"]);
  });

  it("shortens ids, alone or in a short list, as the target is", () => {
    expect(auditDetailLines({ invitationId: ID, messageIds: [ID, ID] })).toEqual(["Invitation id: 3f2a9c1e", "Messages: 3f2a9c1e, 3f2a9c1e"]);
  });

  it("writes a nested object as compact JSON cut to 120 characters", () => {
    const [short] = auditDetailLines({ changes: { allowSelfRegistration: false } });
    expect(short).toBe('Changes: {"allowSelfRegistration":false}');
    const [long] = auditDetailLines({ changes: { features: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`feature${i}`, true])) } });
    expect(long!.startsWith('Changes: {"features":{"feature0":true')).toBe(true);
    expect(long!.length).toBe("Changes: ".length + 120);
    expect(long!.endsWith("…")).toBe(true);
  });
});

describe("the audit log's deny list", () => {
  const hash = phoneHash({ JWT_SECRET: "j".repeat(40), PHONE_HASH_KEY: "k".repeat(40) }, "+919100000036");

  it("never shows the phone hash a deleted account leaves, nor the session a sign-in records", () => {
    const lines = auditDetailLines({ phoneHash: hash, memberships: 2, heldSuspensions: 1 });
    expect(lines).toEqual(["Memberships: 2", "Held suspensions: 1"]);
    expect(lines.join(" ")).not.toContain(hash.slice(0, 8));
    expect(auditDetailLines({ sid: "a1b2c3d4-sid" })).toEqual([]);
  });

  it("drops a private key however it's written and however deep it sits", () => {
    const lines = auditDetailLines({ changes: { contactPhone: "+919100000036", contact_email: "a@b.example", note: "kept" }, items: [{ phone_hash: hash, ok: 1 }], sessionId: "s", ipAddress: "1.2.3.4", IPAddress: "1.2.3.4", otpCode: "123456", apiToken: "t", password: "p" });
    expect(lines).toEqual(['Changes: {"note":"kept"}', "Items: 1 item"]);
    const all = lines.join(" ");
    for (const secret of [hash.slice(0, 8), "9100000036", "a@b.example", "1.2.3.4", "123456"]) expect(all, secret).not.toContain(secret);
  });

  it("marks keys private by their words, and leaves ordinary keys alone", () => {
    for (const key of ["phoneHash", "phone", "phoneE164", "phone_hash", "sid", "sessionId", "ip", "IPAddress", "contactEmail", "otp", "resetToken", "clientSecret", "password"]) expect(isPrivateAuditKey(key), key).toBe(true);
    for (const key of ["reason", "membershipIds", "heldSuspensions", "messageCount", "description", "shipping", "zipCode", "hashtags"]) expect(isPrivateAuditKey(key), key).toBe(false);
  });

  it("never shows a new institution's first admin's number, which platform.tenant.create keeps under initialAdmin", () => {
    expect(isPrivateAuditKey("initialAdmin")).toBe(true);
    const lines = auditDetailLines({ slug: "smoke-institute", initialAdmin: "+917700000000" });
    expect(lines).toEqual(["Slug: smoke-institute"]);
    expect(lines.join(" ")).not.toContain("7700000000");
  });

  it("drops a phone number given as a value under any key, however it's written, and leaves other values alone", () => {
    const md = { contact: "+919100000036", changes: { whatsapp: "+91 91000 00036", note: "kept" }, admins: ["+1 (212) 555-0100", "kept"], periodStart: "2026-01-01", count: 9100000036, ref: "+5" };
    const lines = auditDetailLines(md);
    expect(lines).toEqual(['Changes: {"note":"kept"}', "Admins: kept", "Period start: 2026-01-01", "Count: 9100000036", "Ref: +5"]);
    for (const phone of ["+919100000036", "91000 00036", "555-0100"]) expect(lines.join(" "), phone).not.toContain(phone);
  });

  it("shows only metadata keys known to be safe: each one the API writes is on the list or private", () => {
    const keys = metadataKeys(sources(API_SRC).join("\n"));
    // The scan finds them: the deleted account's hash, the first admin's number and the session id among them.
    for (const key of ["phoneHash", "initialAdmin", "sid", "reason", "membershipIds", "targetKind", "viaReportId"]) expect(keys.has(key), key).toBe(true);
    for (const key of keys) expect(SHOWN_KEYS.has(key) || isPrivateAuditKey(key), `metadata key "${key}" is neither in SHOWN_KEYS nor private`).toBe(true);
    for (const key of SHOWN_KEYS) expect(isPrivateAuditKey(key), key).toBe(false);
  });
});

describe("the audit log's filter text", () => {
  it("reads ?action= trimmed, the first of a repeated one, and at most what the API takes", () => {
    expect(parseAuditAction(" membership. ")).toBe("membership.");
    expect(parseAuditAction(["content.", "report."])).toBe("content.");
    expect(parseAuditAction(undefined)).toBe("");
    expect(parseAuditAction("x".repeat(100))).toHaveLength(80);
  });

  it("says nothing happened yet, or what nothing starts with", () => {
    expect(auditEmptyTitle()).toBe("No activity yet.");
    expect(auditEmptyTitle("  ")).toBe("No activity yet.");
    expect(auditEmptyTitle("chat_report.")).toBe("Nothing starts with “chat_report.”");
  });
});
