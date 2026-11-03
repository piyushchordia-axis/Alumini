export function formatDate(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", ...(timeZone ? { timeZone } : {}) }).format(new Date(iso));
  } catch {
    return new Date(iso).toDateString();
  }
}

export function formatDateTime(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", ...(timeZone ? { timeZone } : {}) }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString();
  }
}

export function timeAgo(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return formatDate(iso);
}

export function formatMoneyMinor(minor: number | null | undefined, currency = "INR"): string {
  if (minor === null || minor === undefined) return "—";
  try {
    return new Intl.NumberFormat(currency === "INR" ? "en-IN" : undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(minor / 100);
  } catch {
    return `${currency} ${Math.round(minor / 100)}`;
  }
}

export function formatAmountRange(min: number | null, max: number | null, currency: string): string {
  if (min == null && max == null) return "Undisclosed";
  if (min != null && max != null) return `${formatMoneyMinor(min, currency)} – ${formatMoneyMinor(max, currency)}`;
  if (min != null) return `from ${formatMoneyMinor(min, currency)}`;
  return `up to ${formatMoneyMinor(max, currency)}`;
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Whether a character is punctuation, a symbol or an emoji rather than the start of a word. The web app asks whether it's a
 * letter or a digit with \p{L} and \p{N}; this asks the other way round, by code point, so it needs no regular expression
 * feature that one JavaScript engine has and another may not, and a name in any script still has its initials.
 */
function isSymbol(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  return (
    c > 0xffff || // beyond the basic plane: emoji, mostly
    /[!-/:-@[-`{-~]/.test(ch) || // ASCII punctuation and symbols
    (c >= 0xa0 && c <= 0xbf) || // Latin-1 punctuation and signs
    c === 0xd7 ||
    c === 0xf7 ||
    (c >= 0x300 && c <= 0x36f) || // combining marks, which belong to the character before
    (c >= 0x2000 && c <= 0x2bff) || // punctuation, arrows, maths, shapes, dingbats and other symbols, the zero-width joiner too
    (c >= 0x3000 && c <= 0x303f) || // CJK punctuation
    (c >= 0xfe00 && c <= 0xfe0f) || // variation selectors, which turn a character into an emoji
    (c >= 0xfe30 && c <= 0xfe4f) ||
    (c >= 0xff00 && c <= 0xff0f)
  );
}

export function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      // Words, not symbols: "London & UK alumni" is "LU", not "L&", and "🏃 Morning runners" is "MR", as on the web app.
      // Whole characters, never half of one: an emoji is two UTF-16 units, and the first alone draws as a broken glyph.
      .map((part) => Array.from(part)[0])
      .filter((first): first is string => first !== undefined && !isSymbol(first))
      .slice(0, 2)
      .map((first) => first.toUpperCase())
      .join("")
  );
}

/** Builds an E.164 number from a dial code and a national number. */
export function toE164(dial: string, national: string): string {
  return `${dial}${national.replace(/\D/g, "")}`;
}
