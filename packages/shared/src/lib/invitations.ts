/**
 * The admin console's invitations, the same on both apps: reading an imported CSV, the template, importing in chunks,
 * and each invitation's status, delivery and actions.
 */
import { MAX_INVITE_IMPORT_ROWS, channelName, type InvitationStatus, type MessageChannel, type TenantType } from "../constants";
import { invitationImportRowSchema, type InvitationImportRow, type InvitationsQuery } from "../schemas/invitations";
import type { InvitationDto, InvitationImportResultDto, ProfileFieldDto } from "../types/dto";
import { formatCount } from "./admin";
import { csvLine, parseCsv, type ParsedCsv } from "./csv";
import { invitationYearsLabel } from "./memberYears";
import { formatPhone } from "./phone";
import { MAX_MULTI_SELECT_VALUES } from "./profileFields";

/** The names a list's columns may give each known detail, as normalizeCsvHeader writes them ("Mobile Number" is "mobile_number"). */
export const INVITE_CSV_HEADERS = {
  phone: ["phone", "mobile", "phone_number", "mobile_number", "whatsapp"],
  name: ["name", "full_name", "fullname"],
  /** The year they joined: a community's "member since". */
  start: ["start_year", "start", "year_joined", "joined", "member_since", "since", "from"],
  /** The year they left or will leave, which many lists call the batch. */
  end: ["end_year", "end", "batch", "batch_year", "year", "graduation_year", "year_left", "until", "to"],
  email: ["email", "email_address", "e_mail"],
} as const;

export type InviteImportField = Pick<ProfileFieldDto, "key" | "label" | "type">;

/** An imported list read for sending: its rows, and which of its columns are used. */
export interface InviteImportMapping {
  rows: InvitationImportRow[];
  /** The phone column's header, or undefined when the list has none, so nothing can be imported. */
  phoneColumn: string | undefined;
  /** The other columns used: the headers of the known details, and the labels of the profile questions. */
  columns: { name: string | undefined; start: string | undefined; end: string | undefined; email: string | undefined; fields: string[] };
  /** Headers that match nothing, left out. */
  ignored: string[];
}

/**
 * Parsed CSV rows as import rows: the known details by any of their names, and the columns named by a profile question's
 * key. The years go by everyday words ("year", "since", "joined"), so a column named for one of the institution's
 * questions is that question's answer only, never a year as well.
 */
export function toImportRows(csv: ParsedCsv, fields: readonly InviteImportField[]): InviteImportMapping {
  const { headers, rows } = csv;
  const pick = (names: readonly string[]) => headers.find((h) => names.includes(h));
  const fieldCols = fields.filter((f) => headers.includes(f.key));
  const questionKeys = new Set(fieldCols.map((f) => f.key));
  const pickYear = (names: readonly string[]) => headers.find((h) => names.includes(h) && !questionKeys.has(h));
  const phoneCol = pick(INVITE_CSV_HEADERS.phone);
  const nameCol = pick(INVITE_CSV_HEADERS.name);
  const startCol = pickYear(INVITE_CSV_HEADERS.start);
  const endCol = pickYear(INVITE_CSV_HEADERS.end);
  const emailCol = pick(INVITE_CSV_HEADERS.email);
  const used = new Set([phoneCol, nameCol, startCol, endCol, emailCol, ...questionKeys]);
  const ignored = headers.filter((h) => h && !used.has(h));
  const out: InvitationImportRow[] = rows.map((r) => ({
    phone: phoneCol ? (r[phoneCol] ?? "") : "",
    name: nameCol ? r[nameCol] || null : null,
    startYear: startCol ? r[startCol] || null : null,
    batchYear: endCol ? r[endCol] || null : null,
    email: emailCol ? r[emailCol] || null : null,
    fields: Object.fromEntries(
      fieldCols
        .map((f) => {
          const raw = r[f.key] ?? "";
          if (!raw) return [f.key, null] as const;
          // Several choices are written "a; b" in one cell; yes/no as yes/no/true/false/1/0.
          if (f.type === "MULTI_SELECT") return [f.key, raw.split(/[;|]/).map((s) => s.trim()).filter(Boolean)] as const;
          if (f.type === "BOOLEAN") return [f.key, /^(y|yes|true|1)$/i.test(raw) ? true : /^(n|no|false|0)$/i.test(raw) ? false : raw] as const;
          if (f.type === "NUMBER" && raw.trim() !== "" && Number.isFinite(Number(raw))) return [f.key, Number(raw)] as const;
          return [f.key, raw] as const;
        })
        .filter(([, v]) => v !== null),
    ),
  }));
  return { rows: out, phoneColumn: phoneCol, columns: { name: nameCol, start: startCol, end: endCol, email: emailCol, fields: fieldCols.map((f) => f.label) }, ignored };
}

/** A picked file's text read as an invitation list, or why it can't be imported. */
export function readInvitationCsv(text: string, fields: readonly InviteImportField[]): { mapping: InviteImportMapping; problem?: undefined } | { mapping?: undefined; problem: string } {
  const mapping = toImportRows(parseCsv(text), fields);
  if (!mapping.phoneColumn) return { problem: 'No phone column found. Name a column "phone" (see the template).' };
  // The API takes no empty import.
  if (mapping.rows.length === 0) return { problem: "That file has only a header row." };
  return { mapping };
}

/** "1 row", "1,200 rows". */
export function rowCountText(n: number): string {
  return `${formatCount(n)} ${n === 1 ? "row" : "rows"}`;
}

/** The preview's first line after the file's name: "2 rows. Using phone, name, start year, end year, Chapter." */
export function importSummaryText(m: InviteImportMapping): string {
  const used = ["phone", m.columns.name && "name", m.columns.start && "start year", m.columns.end && "end year", m.columns.email && "email", ...m.columns.fields].filter(Boolean);
  return `${rowCountText(m.rows.length)}. Using ${used.join(", ")}.`;
}

/**
 * A previewed row's years as typed, worded as an invitation's are (invitationYearsLabel): "2008–2012", "From 2008",
 * "2012", or "". A cell that isn't a year shows as it is, for the API to refuse with its reason.
 */
export function importRowYears(row: Pick<InvitationImportRow, "startYear" | "batchYear">): string {
  const cell = (v: InvitationImportRow["startYear"]) => (v == null ? "" : String(v).trim());
  const start = cell(row.startYear);
  const end = cell(row.batchYear);
  if (start && end) return start === end ? start : `${start}–${end}`;
  return start ? `From ${start}` : end;
}

/** A previewed row's details under its phone: "Asha Rao · 2008–2012 · asha@example.com". */
export function importRowMeta(row: Pick<InvitationImportRow, "name" | "startYear" | "batchYear" | "email">): string {
  return [row.name, importRowYears(row), row.email].filter(Boolean).join(" · ");
}

/** The columns left out, "Ignoring: notes.", or null. */
export function importIgnoredText(m: InviteImportMapping): string | null {
  return m.ignored.length > 0 ? `Ignoring: ${m.ignored.join(", ")}.` : null;
}

export const INVITATION_TEMPLATE_FILE = "invitations-template.csv";

/** Above the import's buttons: the columns a list may have. At a community, a blank end year means they still belong. */
export function invitationColumnsHint(type: TenantType): string {
  const years = type === "OTHER" ? "start year, end year (blank for someone who still belongs)" : "start year, end year";
  return `A CSV with a phone column, and optionally name, ${years}, email and your profile field keys. Numbers without a country code use your institution's country.`;
}

/**
 * Under the import's buttons. Excel turns a typed +919876543210 into a number (shown 9.19876E+11, which the API refuses)
 * unless the column is text, and a CSV saved another way loses names in other scripts.
 */
export const INVITATION_CSV_HINT = "In Excel, format the phone column as Text before typing numbers, and save as CSV UTF-8 so names keep their accents and scripts.";

/**
 * The import template: the known columns and the institution's question keys, with an example row. At a community the
 * example still belongs, so its end year is blank. Without the BOM: add it with withBom when saving.
 */
export function invitationTemplateCsv(fields: readonly Pick<ProfileFieldDto, "key" | "options">[], type: TenantType): string {
  const headers = ["phone", "name", "start_year", "end_year", "email", ...fields.map((f) => f.key)];
  const example = ["+919876543210", "Asha Rao", "2008", type === "OTHER" ? "" : "2012", "asha@example.com", ...fields.map((f) => f.options[0]?.value ?? "")];
  // csvCell marks a cell starting "+" as text against formula injection, which would show the example phone as
  // '+919876543210: it's there to be copied as it is.
  return csvLine(headers) + csvLine(example).replace(/^'/, "");
}

/** One request's worth of an import: its rows, and the rows sent before it, so the API's line numbers match the file's. */
export interface InviteImportChunk<T = InvitationImportRow> {
  rows: T[];
  rowOffset: number;
}

/** An import in requests of at most `size` rows (the API's limit). The data rows start on line 2 of the file, under its header. */
export function chunkInviteRows<T>(rows: readonly T[], size = MAX_INVITE_IMPORT_ROWS): InviteImportChunk<T>[] {
  const chunks: InviteImportChunk<T>[] = [];
  for (let i = 0; i < rows.length; i += size) chunks.push({ rows: rows.slice(i, i + size), rowOffset: i + 1 });
  return chunks;
}

/** The answers to an import's requests as one. */
export function sumImportResults(results: readonly InvitationImportResultDto[]): InvitationImportResultDto {
  const total: InvitationImportResultDto = { created: 0, updated: 0, skipped: 0, queued: 0, results: [] };
  for (const r of results) {
    total.created += r.created;
    total.updated += r.updated;
    total.skipped += r.skipped;
    total.queued += r.queued;
    total.results.push(...r.results);
  }
  return total;
}

/** What an import did, and how far it got if a request failed. */
export interface ChunkedImportOutcome {
  result: InvitationImportResultDto;
  /** The rows the API took, in the requests before any failure. */
  imported: number;
  /** Why a request failed: the import stopped there. */
  error?: unknown;
}

/** The API's names for a row's details, in the reasons a row is left out. */
const IMPORT_DETAIL_NAMES: Readonly<Record<string, string>> = { phone: "Phone number", name: "Name", email: "Email address" };

/**
 * Why the API would refuse the whole request carrying this row, or null. The API checks each row's details itself and
 * gives each row its reason, but a cell longer than it takes at all ("Class of 2012" as a year) fails the request's
 * own check first. `fields` names the questions.
 */
export function importRowTooLong(row: InvitationImportRow, fields: readonly InviteImportField[] = []): string | null {
  const parsed = invitationImportRowSchema.safeParse(row);
  if (parsed.success) return null;
  const [top, key] = parsed.error.issues[0]?.path ?? [];
  if (top === "fields" && typeof key === "string") {
    const label = fields.find((f) => f.key === key)?.label ?? key;
    const value = row.fields?.[key];
    if (Array.isArray(value) && value.length > MAX_MULTI_SELECT_VALUES) return `${label}: at most ${MAX_MULTI_SELECT_VALUES} choices`;
    return `${label} is too long`;
  }
  if (top === "startYear") return "Start year is too long to be a year";
  if (top === "batchYear") return "End year is too long to be a year";
  return `${IMPORT_DETAIL_NAMES[String(top)] ?? "A cell"} is too long`;
}

/** A row's phone as its problem line shows it: a cell too long is cut short. */
function shownPhone(phone: string): string {
  return phone.length > 40 ? `${phone.slice(0, 39)}…` : phone;
}

/**
 * Sends an import chunk by chunk, one request at a time, saying after each how many rows have gone. A failed request
 * stops it, with what the earlier ones did: importing the file again updates their rows rather than adding them twice.
 *
 * A row the API would refuse with its whole request (importRowTooLong) goes as a blank row instead, which the API leaves
 * out as invalid on the same line, so the rows after it keep their line numbers; its own reason then replaces the API's.
 * `fields` names the questions in those reasons.
 */
export async function importInChunks(
  rows: readonly InvitationImportRow[],
  send: (chunk: InviteImportChunk) => Promise<InvitationImportResultDto>,
  { fields = [], onProgress }: { fields?: readonly InviteImportField[]; onProgress?: (done: number, total: number) => void } = {},
): Promise<ChunkedImportOutcome> {
  // By line: the data rows start on line 2, under the header, as chunkInviteRows numbers them.
  const tooLong = new Map<number, { phone: string; message: string }>();
  const sendable = rows.map((row, i): InvitationImportRow => {
    const message = importRowTooLong(row, fields);
    if (!message) return row;
    tooLong.set(i + 2, { phone: shownPhone(row.phone), message });
    return { phone: "" };
  });
  const answers: InvitationImportResultDto[] = [];
  let imported = 0;
  for (const chunk of chunkInviteRows(sendable)) {
    let answer: InvitationImportResultDto;
    try {
      answer = await send(chunk);
    } catch (error) {
      return { result: sumImportResults(answers), imported, error };
    }
    answers.push(tooLong.size > 0 ? { ...answer, results: answer.results.map((r) => (r.status === "invalid" && tooLong.has(r.row) ? { ...r, ...tooLong.get(r.row)! } : r)) } : answer);
    imported += chunk.rows.length;
    onProgress?.(imported, rows.length);
  }
  return { result: sumImportResults(answers), imported };
}

/** While an import goes: "Importing 500 of 1,200…". */
export function importProgressText(done: number, total: number): string {
  return `Importing ${formatCount(done)} of ${formatCount(total)}…`;
}

/**
 * Whether a failed request may go through if sent again: the server couldn't be reached, broke or was limiting, as the
 * client's isTransientError says. It reads the error's status rather than importing ApiClientError, because lib/ doesn't
 * depend on the client.
 */
function mayGoThroughLater(error: unknown): boolean {
  const status = error !== null && typeof error === "object" && "status" in error ? error.status : undefined;
  return typeof status !== "number" || status === 0 || status === 429 || status >= 500;
}

/**
 * After an import's failed request (`error`), with what went before it. Null when nothing had gone yet. Importing the
 * file again finishes it only when the failure may pass; any other answer would come again, so then it only says what
 * went, and that importing again won't add those twice.
 */
export function partialImportText(imported: number, error?: unknown): string | null {
  if (imported === 0) return null;
  const done = `The first ${rowCountText(imported)} were imported.`;
  return mayGoThroughLater(error) ? `${done} Import the file again to finish: rows already imported are updated, not duplicated.` : `${done} Importing the file again updates them rather than adding them twice.`;
}

/** The import's result in full: "2 new, 0 updated, 0 skipped, 1 being sent." */
export function importResultText(r: InvitationImportResultDto): string {
  return `${formatCount(r.created)} new, ${formatCount(r.updated)} updated, ${formatCount(r.skipped)} skipped${r.queued ? `, ${formatCount(r.queued)} being sent` : ""}.`;
}

/** The import's result, short, said on the list once the import has closed: "2 invited, 0 updated". */
export function importDoneText(r: InvitationImportResultDto): string {
  return `${formatCount(r.created)} invited, ${formatCount(r.updated)} updated${r.queued ? `, ${formatCount(r.queued)} sending` : ""}`;
}

export type ImportRowResult = InvitationImportResultDto["results"][number];

/** The rows an import left out, by line: invalid, or already a member. */
export function importProblems(r: InvitationImportResultDto): ImportRowResult[] {
  return r.results.filter((row) => row.status === "invalid" || row.status === "member");
}

/** A tab of the invitations list: a status, Expired, or All. */
export type InvitationTab = "ALL" | InvitationStatus | "EXPIRED";

export const INVITATION_TABS: readonly { value: InvitationTab; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "PENDING", label: "Not sent" },
  { value: "SENT", label: "Sent" },
  { value: "ACCEPTED", label: "Joined" },
  { value: "EXPIRED", label: "Expired" },
  { value: "REVOKED", label: "Revoked" },
];

/** The list's tab from its address (?status=): All for anything else. An app's router may give a repeated parameter as a list. */
export function parseInvitationTab(raw: unknown): InvitationTab {
  const value: unknown = Array.isArray(raw) ? raw[0] : raw;
  return INVITATION_TABS.find((t) => t.value === value)?.value ?? "ALL";
}

/** The API's status filter for a tab: none for All. */
export function invitationStatusFilter(tab: InvitationTab): InvitationsQuery["status"] {
  return tab === "ALL" ? undefined : tab;
}

export type InvitationTone = "neutral" | "warning" | "info" | "success" | "danger";

/** An invitation's badge. Expiry comes first: an expired invitation keeps the status it had (Not sent, Sent). */
export function invitationStatusView(inv: Pick<InvitationDto, "status" | "expired">): { label: string; tone: InvitationTone } {
  if (inv.expired) return { label: "Expired", tone: "neutral" };
  switch (inv.status) {
    case "PENDING":
      return { label: "Not sent", tone: "warning" };
    case "SENT":
      return { label: "Sent", tone: "info" };
    case "ACCEPTED":
      return { label: "Joined", tone: "success" };
    case "REVOKED":
      return { label: "Revoked", tone: "danger" };
  }
}

/** Who an invitation is for: their name, or their number. */
export function invitationName(inv: Pick<InvitationDto, "fullName" | "phone">): string {
  return inv.fullName ?? formatPhone(inv.phone);
}

/** A row's details line, "+91 98765 43210 · 2008–2012 · asha@example.com", leaving out the number when it's the row's title. */
export function invitationMeta(inv: Pick<InvitationDto, "fullName" | "phone" | "startYear" | "batchYear" | "email">): string {
  return [inv.fullName ? formatPhone(inv.phone) : null, invitationYearsLabel(inv), inv.email].filter(Boolean).join(" · ");
}

/**
 * How the latest message for an invitation went: "Delivered by WhatsApp · 2h ago". `timeAgo` is the app's, as Hermes may
 * lack Intl. A dash for one never sent; nothing for one sent before messages were kept.
 */
export function deliveryText(inv: Pick<InvitationDto, "delivery" | "sendCount">, timeAgo: (iso: string) => string): string {
  const d = inv.delivery;
  if (!d) return inv.sendCount ? "" : "—";
  const via = d.channel ? ` by ${channelName(d.channel)}` : "";
  switch (d.status) {
    case "QUEUED":
    case "SENDING":
      return "Sending…";
    case "SENT":
    case "DELIVERED":
    case "READ":
      return `${d.status === "READ" ? "Read" : d.status === "DELIVERED" ? "Delivered" : "Sent"}${via} · ${timeAgo(d.at)}`;
    case "FAILED":
      return `Failed${via}${d.lastError ? `: ${d.lastError}` : ""}`;
    case "CANCELLED":
      return "Not sent (closed before sending)";
  }
}

/** "sent 3 times", for one sent more than once, or null. */
export function sendCountText(inv: Pick<InvitationDto, "sendCount">): string | null {
  return inv.sendCount > 1 ? `sent ${formatCount(inv.sendCount)} times` : null;
}

/** Whether an invitation's link still works: waiting to be sent or accepted, and not expired. */
export function isOpenInvitation(inv: Pick<InvitationDto, "status" | "expired">): boolean {
  return (inv.status === "PENDING" || inv.status === "SENT") && !inv.expired;
}

/** What can be done to an invitation: its link copied or shared while open, sent while open on a plan that sends, and revoked until it's accepted or revoked. */
export function invitationActions(inv: Pick<InvitationDto, "status" | "expired" | "link">, channels: readonly MessageChannel[]): { copy: boolean; whatsapp: boolean; send: boolean; revoke: boolean } {
  const open = isOpenInvitation(inv);
  return { copy: open && !!inv.link, whatsapp: open && !!inv.link, send: open && channels.length > 0, revoke: inv.status !== "ACCEPTED" && inv.status !== "REVOKED" };
}

export type InvitationAction = "copy" | "whatsapp" | "send" | "revoke";

/** A row's button, as written on it. */
export function invitationActionText(action: InvitationAction, inv: Pick<InvitationDto, "sendCount">): string {
  switch (action) {
    case "copy":
      return "Copy link";
    case "whatsapp":
      return "WhatsApp";
    case "send":
      return inv.sendCount ? "Resend" : "Send";
    case "revoke":
      return "Revoke";
  }
}

/** A row's button named with its invitation, so a screen reader can tell one row's from the next: "Copy link for Asha Rao". */
export function invitationActionLabel(action: InvitationAction, inv: Pick<InvitationDto, "sendCount" | "fullName" | "phone">): string {
  const name = invitationName(inv);
  switch (action) {
    case "copy":
      return `Copy link for ${name}`;
    case "whatsapp":
      return `Share on WhatsApp with ${name}`;
    case "send":
      return `${inv.sendCount ? "Resend" : "Send"} to ${name}`;
    case "revoke":
      return `Revoke the invitation for ${name}`;
  }
}

/** What Send or Resend did: the API queues nothing for one sent less than a day ago. */
export function sentText(queued: number, wasSent: boolean): string {
  if (queued === 0) return "Sent less than a day ago; try again later";
  return wasSent ? "Invitation sent again" : "Invitation sent";
}

/** The confirmation before revoking. */
export function revokeInvitationCopy(inv: Pick<InvitationDto, "fullName" | "phone">): { title: string; body: string; confirm: string } {
  return { title: `Revoke the invitation for ${invitationName(inv)}?`, body: "The link stops working.", confirm: "Revoke" };
}

export const INVITATION_REVOKED_TEXT = "Invitation revoked";

/** The message an admin sends with a link from their own phone. */
export function inviteShareText(tenantName: string, link: string): string {
  return `You're invited to join the ${tenantName} alumni network on Illuminize: ${link}`;
}

/** WhatsApp's link to a chat with `phone`, the message typed in. */
export function whatsappUrl(phone: string, text: string): string {
  return `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}

/** The plan's channels in the order they're tried: "WhatsApp, then SMS". */
export function channelOrderText(channels: readonly MessageChannel[]): string {
  return channels.map(channelName).join(", then ");
}

/** Under the figures: how the plan sends invitations, or that the admin shares the links. */
export function channelsSentence(channels: readonly MessageChannel[]): string {
  return channels.length > 0
    ? `Your plan sends invitations by ${channelOrderText(channels)}. Each invitation can be resent once a day.`
    : "Your plan doesn't include WhatsApp, SMS or email messages: copy an invitation's link or share it on WhatsApp from your own phone.";
}

/** The import's choice to send at once, or why there's none. */
export function sendNowLabel(channels: readonly MessageChannel[]): string {
  return channels.length > 0 ? `Send the invitations now (by ${channelOrderText(channels)})` : "Sending isn't included in your plan; you'll share the links yourself";
}

/** Send pending's button, and the confirmation before it: every one is a billed message. */
export function sendPendingCopy(pending: number, channels: readonly MessageChannel[], sendableToday: number): { label: string; title: string; body: string; confirm: string } {
  return {
    label: `Send ${formatCount(pending)} pending`,
    title: pending === 1 ? "Send 1 invitation?" : `Send ${formatCount(pending)} invitations?`,
    // The plan can stop sending while the question is open: the figures then come back with no channel.
    body: `${channels.length > 0 ? `By ${channelOrderText(channels)}. ` : ""}Messages are billed per delivery; up to ${formatCount(sendableToday)} more can go today.`,
    confirm: "Send",
  };
}

/** What Send pending did, by the API's count. */
export function sendPendingDoneText(queued: number): string {
  return queued > 0 ? `Sending ${formatCount(queued)} ${queued === 1 ? "invitation" : "invitations"}` : "Nothing to send";
}
