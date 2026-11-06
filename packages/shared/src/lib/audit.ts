import type { AuditDto } from "../types/dto";

/** A filter of the audit log: the actions whose names start with `prefix`. */
export interface AuditActionFilter {
  label: string;
  prefix: string;
}

/**
 * The audit log's filters on both consoles, one for each family of actions the API records at an institution but a
 * member's own email unsubscribe (`notifications.`), which can be typed. Mentors are the list (opting in or out, an admin
 * taking one off it); Mentorships are the requests between members. Platform is what Illuminize staff did there.
 */
export const AUDIT_ACTION_FILTERS: readonly AuditActionFilter[] = [
  { label: "Members", prefix: "membership." },
  { label: "Content", prefix: "content." },
  { label: "Reports", prefix: "report." },
  { label: "Chat reports", prefix: "chat_report." },
  { label: "Invitations", prefix: "invitation." },
  { label: "Profile fields", prefix: "profile_field." },
  { label: "Settings", prefix: "tenant." },
  { label: "Mentors", prefix: "mentor." },
  { label: "Mentorships", prefix: "mentorship." },
  { label: "Referrals", prefix: "referral." },
  { label: "Exports", prefix: "export." },
  { label: "Platform", prefix: "platform." },
];

/** What the audit log says it is, on both consoles. */
export const AUDIT_LOG_INTRO = "Every admin and member action, newest first";

/** The API takes an action filter of up to 80 characters (auditQuerySchema). */
export const AUDIT_ACTION_MAX = 80;

/** The action filter from an address (?action=), trimmed. A router may give a repeated parameter as a list. */
export function parseAuditAction(raw: unknown): string {
  const value: unknown = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" ? value.trim().slice(0, AUDIT_ACTION_MAX) : "";
}

/** The audit log with nothing to show: "No activity yet.", or for a filter, what nothing starts with. */
export function auditEmptyTitle(filter?: string | null): string {
  const f = filter?.trim();
  return f ? `Nothing starts with “${f}”` : "No activity yet.";
}

/** Who did it: their name at the institution, Illuminize staff or the system acting without one, or nobody recorded. */
export function auditActorLabel(a: Pick<AuditDto, "actorName" | "actorUserId">): string {
  return a.actorName ?? (a.actorUserId ? "Platform / system" : "—");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An id as the log shows it, its first 8 characters, which tell rows apart without filling them. */
const shortId = (value: string) => (UUID.test(value) ? value.slice(0, 8) : value);

/**
 * What it was done to, short: "membership 3f2a9c1e". A membership comes with its id, so the row can link to the member's
 * admin page; only a UUID, as it goes into a route.
 */
export function auditTargetLabel(a: Pick<AuditDto, "targetType" | "targetId">): { text: string; membershipId?: string } {
  if (!a.targetType) return { text: "—" };
  const text = a.targetId ? `${a.targetType} ${a.targetId.slice(0, 8)}` : a.targetType;
  return a.targetType === "membership" && a.targetId && UUID.test(a.targetId) ? { text, membershipId: a.targetId } : { text };
}

/**
 * Words that mark a metadata key private, which the log never shows at any depth: the account deletion's keyed hash of
 * the phone (shown, it could be copied and matched), a sign-in's session id, and any phone number, address, secret or
 * token. Matched by word, so "phoneHash", "phone_e164" and "contactEmail" are all caught.
 */
const PRIVATE_KEY_WORDS = new Set(["phone", "hash", "token", "secret", "password", "otp", "sid", "session", "ip", "email"]);

/**
 * Keys the API writes a private value under that their words don't say: a new institution's first admin, by phone
 * number (`platform.tenant.create`), which would stay readable after that admin deleted their account.
 */
const PRIVATE_KEYS = new Set(["initialAdmin"]);

/** A phone number as a value, under whatever key: "+919100000036", or written with spaces, dashes or brackets. */
function looksLikePhone(value: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(value.replace(/[\s().-]/g, ""));
}

function keyWords(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

/** Whether the audit log keeps a metadata key to itself. */
export function isPrivateAuditKey(key: string): boolean {
  return PRIVATE_KEYS.has(key) || keyWords(key).some((w) => PRIVATE_KEY_WORDS.has(w));
}

const isPhoneValue = (v: unknown) => typeof v === "string" && looksLikePhone(v);

/** The metadata without its private keys, nor any phone number given as a value, at any depth. */
function withoutPrivate(value: unknown): unknown {
  if (Array.isArray(value)) return value.filter((v) => !isPhoneValue(v)).map(withoutPrivate);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key, v]) => !isPrivateAuditKey(key) && !isPhoneValue(v))
        .map(([key, v]) => [key, withoutPrivate(v)]),
    );
  }
  return value;
}

/** Keys whose words alone wouldn't say it. */
const KEY_LABELS: Readonly<Record<string, string>> = {
  fields: "Changed",
  membershipIds: "Members",
  adminIds: "Admins",
  messageIds: "Messages",
  messageCount: "Message count",
  contentType: "Content",
  targetKind: "Reported",
};

function keyLabel(key: string): string {
  const words = keyWords(key).join(" ");
  return KEY_LABELS[key] ?? (words.charAt(0).toUpperCase() + words.slice(1));
}

/** Nested metadata is shown as compact JSON, cut to this many characters. */
const NESTED_MAX = 120;

function valueText(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "string") return shortId(v);
  if (typeof v === "number" || typeof v === "boolean") return typeof v === "boolean" ? (v ? "Yes" : "No") : String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return null;
    if (v.length <= 5 && v.every((x) => typeof x === "string" || typeof x === "number")) return v.map((x) => (typeof x === "string" ? shortId(x) : String(x))).join(", ");
    return `${v.length} ${v.length === 1 ? "item" : "items"}`;
  }
  const json = JSON.stringify(v);
  if (!json || json === "{}") return null;
  return json.length > NESTED_MAX ? `${json.slice(0, NESTED_MAX - 1)}…` : json;
}

const isScalar = (v: unknown): v is string | number | boolean => typeof v === "string" || typeof v === "number" || typeof v === "boolean";

/**
 * An audit row's metadata as lines to read: a change of status or role as "PENDING → APPROVED", then the reason, then
 * the rest as "Label: value". Private keys (isPrivateAuditKey) and phone numbers never show. Metadata never holds
 * message bodies or request notes (CLAUDE.md), so the rest is safe to show to the institution's admins.
 */
export function auditDetailLines(metadata: Readonly<Record<string, unknown>> | null | undefined): string[] {
  const md = withoutPrivate(metadata ?? {}) as Record<string, unknown>;
  const lines: string[] = [];
  const rest = { ...md };
  if (isScalar(md.from) && isScalar(md.to)) {
    lines.push(`${valueText(md.from) ?? "—"} → ${valueText(md.to) ?? "—"}`);
    delete rest.from;
    delete rest.to;
  }
  const keys = Object.keys(rest);
  for (const key of keys.includes("reason") ? ["reason", ...keys.filter((k) => k !== "reason")] : keys) {
    const text = valueText(rest[key]);
    if (text !== null) lines.push(`${keyLabel(key)}: ${text}`);
  }
  return lines;
}
