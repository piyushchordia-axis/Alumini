/**
 * Time-zone helpers that work in browsers, Node and Hermes (iOS/Android) without
 * extra dependencies. A "wall time" is what a person reads on a clock in a given
 * place, written as "YYYY-MM-DDTHH:mm" (no offset).
 */

export interface WallParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

const WALL_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** True when "YYYY-MM-DD" is a real calendar date (rejects 2026-02-30, 2026-13-01). */
export function isValidCalendarDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function parseWallTime(value: string): WallParts | null {
  const m = WALL_RE.exec(value.trim());
  if (!m) return null;
  const parts = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), hour: Number(m[4]), minute: Number(m[5]) };
  if (!isValidCalendarDate(`${m[1]}-${m[2]}-${m[3]}`) || parts.hour > 23 || parts.minute > 59) return null;
  return parts;
}

export function formatWallTime(p: WallParts): string {
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Wall-clock parts of an instant as seen in `timeZone`. */
export function wallPartsInZone(instant: Date, timeZone: string): WallParts & { second: number } {
  const f = formatterFor(timeZone);
  let year = 0,
    month = 0,
    day = 0,
    hour = 0,
    minute = 0,
    second = 0;
  if (typeof f.formatToParts === "function") {
    for (const p of f.formatToParts(instant)) {
      const v = Number(p.value);
      if (p.type === "year") year = v;
      else if (p.type === "month") month = v;
      else if (p.type === "day") day = v;
      else if (p.type === "hour") hour = v;
      else if (p.type === "minute") minute = v;
      else if (p.type === "second") second = v;
    }
  } else {
    // "MM/DD/YYYY, HH:mm:ss"
    const m = /(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2}):(\d{2})/.exec(f.format(instant));
    if (m) [month, day, year, hour, minute, second] = [m[1], m[2], m[3], m[4], m[5], m[6]].map(Number) as [number, number, number, number, number, number];
  }
  if (hour === 24) hour = 0; // some engines render midnight as 24 even with h23
  return { year, month, day, hour, minute, second };
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds (e.g. +19800000 for Asia/Kolkata). */
export function zoneOffsetMs(instant: Date, timeZone: string): number {
  const p = wallPartsInZone(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const truncated = Math.floor(instant.getTime() / 1000) * 1000;
  return asUtc - truncated;
}

/**
 * Converts a wall time in `timeZone` to an ISO instant.
 * Returns null for malformed or impossible input. For times skipped by a DST
 * jump the result moves forward by the gap, like most calendar apps.
 */
export function zonedWallTimeToUtc(wall: string, timeZone: string): string | null {
  const p = parseWallTime(wall);
  if (!p) return null;
  const guess = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  try {
    const offset1 = zoneOffsetMs(new Date(guess), timeZone);
    const a = guess - offset1;
    const offset2 = zoneOffsetMs(new Date(a), timeZone);
    if (offset2 === offset1) return new Date(a).toISOString();
    // Offsets differ around a DST change: keep the candidate that maps back to the same wall time
    // (earliest one when the hour repeats). If none does, the time was skipped: move forward.
    const b = guess - offset2;
    const matches = [a, b].filter((t) => formatWallTime(wallPartsInZone(new Date(t), timeZone)) === formatWallTime(p)).sort((x, y) => x - y);
    return new Date(matches[0] ?? Math.max(a, b)).toISOString();
  } catch {
    return null;
  }
}

/** Formats an ISO instant as a wall time ("YYYY-MM-DDTHH:mm") in `timeZone`. */
export function utcToZonedWallTime(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return formatWallTime(wallPartsInZone(d, timeZone));
  } catch {
    return "";
  }
}

/** Short label like "GMT+5:30" for showing next to a time zone name. */
export function zoneOffsetLabel(timeZone: string, at: Date = new Date()): string {
  try {
    const minutes = Math.round(zoneOffsetMs(at, timeZone) / 60000);
    const sign = minutes >= 0 ? "+" : "-";
    const abs = Math.abs(minutes);
    return `GMT${sign}${Math.floor(abs / 60)}${abs % 60 ? `:${pad(abs % 60)}` : ""}`;
  } catch {
    return "";
  }
}

/** Device/browser time zone, falling back to UTC. */
export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Common time zones offered in pickers, India first. */
export const COMMON_TIME_ZONES = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Hong_Kong",
  "Asia/Riyadh",
  "Asia/Qatar",
  "Asia/Kathmandu",
  "Asia/Dhaka",
  "Asia/Colombo",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Amsterdam",
  "Europe/Zurich",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Sao_Paulo",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Pacific/Auckland",
  "Africa/Johannesburg",
  "Africa/Nairobi",
  "UTC",
] as const;
