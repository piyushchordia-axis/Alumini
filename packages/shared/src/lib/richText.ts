/**
 * Plain text with bullet lists and clickable links, for long descriptions (jobs, events, funding, businesses, bios). There is
 * no markdown emphasis. Posts, comments and chat stay plain text on purpose: links in the feed invite spam.
 *
 * Every pass is linear in the length of the text, and no regular expression here can backtrack catastrophically.
 */

/** A run of text, or a link whose text is exactly what was written. */
export type RichInline = { type: "text"; text: string } | { type: "link"; href: string; text: string };

/**
 * A paragraph keeps its line breaks. A list item is one run of inlines: an indented line under an item joins it with a
 * space. A numbered list keeps the number it started at; a bullet list's `start` is 1.
 */
export type RichBlock = { type: "paragraph"; lines: RichInline[][] } | { type: "list"; ordered: boolean; start: number; items: RichInline[][] };

/** Said under every field that renders as rich text. */
export const RICH_TEXT_HINT = "Start a line with - for a bullet point. Links become clickable.";

const MAX_LINK_LENGTH = 2048;

/** Zero-width and bidirectional control characters, which can disguise where a link goes or reorder what it shows. */
const INVISIBLE_CHARS = "\\u061c\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2064\\u2066-\\u2069\\ufeff";
const INVISIBLE = new RegExp(`[${INVISIBLE_CHARS}]`);
const INVISIBLE_ALL = new RegExp(`[${INVISIBLE_CHARS}]`, "g");

/**
 * Punctuation that never belongs to a web address, so one ends there however it's written: curly and angle quotes (as
 * word processors and phone keyboards type them, "’s" included), the em dash, and CJK and full-width punctuation and
 * brackets, which Chinese and Japanese write with no space after an address.
 */
const URL_STOP_CHARS =
  "\\u00ab\\u00bb\\u2014\\u2018-\\u201f\\u2039\\u203a\\u3001\\u3002\\u3008-\\u3011\\u3014\\u3015\\uff01\\uff08\\uff09\\uff0c\\uff0e\\uff1a\\uff1b\\uff1f\\uff3b\\uff3d\\uff5b\\uff5d";

/**
 * Joiners (ZWNJ, ZWJ) shape emoji sequences and Indic and Persian script, so one between two characters beyond ASCII stays.
 * Next to ASCII it can only hide something, as in a split web address, so it goes like the rest.
 */
const joinsScript = (ch: string | undefined) => ch !== undefined && ch > "\u007f" && !INVISIBLE.test(ch);

const LINE_BREAK = new RegExp("\\r\\n?|[\\u2028\\u2029]", "g");
const isJoiner = (ch: string) => ch.charCodeAt(0) === 0x200c || ch.charCodeAt(0) === 0x200d;
const JOINERS = /[‌‍]/g;
/** A web address with any joiners kept in it. Once the other invisible characters are gone, joiners are all that's left. */
const URL_WITH_JOINERS = new RegExp(`https?://[^\\s<>"'${URL_STOP_CHARS}]+`, "gi");

/**
 * No joiner survives inside a web address, even between two characters beyond ASCII: kept, it would end the link there
 * with nothing to show that the address goes on as text ("https://例" linked, then "子.com").
 */
function clean(text: string): string {
  return text
    .replace(LINE_BREAK, "\n")
    .replace(INVISIBLE_ALL, (ch: string, at: number, all: string) => (isJoiner(ch) && joinsScript(all[at - 1]) && joinsScript(all[at + 1]) ? ch : ""))
    .replace(URL_WITH_JOINERS, (address) => address.replace(JOINERS, ""));
}

const BULLET = /^\s{0,3}[-*•●▪◦–]\s+(?=\S)/;
const NUMBERED = /^\s{0,3}(\d{1,3})[.)]\s+(?=\S)/;
const BLANK = /^\s*$/;
const LEADING_INDENT = /^[ \t]*/;

function listItem(line: string): { ordered: boolean; start: number; text: string } | null {
  const bullet = BULLET.exec(line);
  if (bullet) return { ordered: false, start: 1, text: line.slice(bullet[0].length).trim() };
  const numbered = NUMBERED.exec(line);
  if (numbered) return { ordered: true, start: Number(numbered[1]), text: line.slice(numbered[0].length).trim() };
  return null;
}

/** A tab counts as two spaces, so either continues the item above. */
const indentWidth = (line: string) => LEADING_INDENT.exec(line)![0].replace(/\t/g, "  ").length;

type OpenBlock = { type: "paragraph"; lines: string[] } | { type: "list"; ordered: boolean; start: number; items: string[] };

function close(block: OpenBlock): RichBlock {
  return block.type === "paragraph"
    ? { type: "paragraph", lines: block.lines.map(linkCleanLine) }
    : { type: "list", ordered: block.ordered, start: block.start, items: block.items.map(linkCleanLine) };
}

/**
 * Splits text into paragraphs and lists. A line starting with `-`, `*`, `•`, `●`, `▪`, `◦` or `–` and a space is a bullet
 * ("-5°C" isn't); `1.` or `1)` and a space starts a numbered item. A blank line ends a block.
 */
export function parseRichText(text: string | null | undefined): RichBlock[] {
  if (!text) return [];
  const blocks: RichBlock[] = [];
  let open: OpenBlock | null = null;
  for (const line of clean(text).split("\n")) {
    if (BLANK.test(line)) {
      if (open) blocks.push(close(open));
      open = null;
      continue;
    }
    const item = listItem(line);
    if (item) {
      if (open?.type !== "list" || open.ordered !== item.ordered) {
        if (open) blocks.push(close(open));
        open = { type: "list", ordered: item.ordered, start: item.start, items: [] };
      }
      open.items.push(item.text);
      continue;
    }
    if (open?.type === "list" && indentWidth(line) >= 2) {
      const last = open.items.length - 1;
      open.items[last] = `${open.items[last]} ${line.trim()}`;
      continue;
    }
    if (open?.type !== "paragraph") {
      if (open) blocks.push(close(open));
      open = { type: "paragraph", lines: [] };
    }
    open.lines.push(line.trim());
  }
  if (open) blocks.push(close(open));
  return blocks;
}

/** A web address runs to whitespace, a quote, an angle bracket, an invisible character or other punctuation it can't hold. */
const URL_CANDIDATE = new RegExp(`https?://[^\\s<>"'${INVISIBLE_CHARS}${URL_STOP_CHARS}]+`, "gi");
/**
 * What ends a sentence rather than an address: the ASCII marks, and the ellipsis (typed as one character by phones), the
 * en dash, the Devanagari danda and double danda, and the Arabic and Urdu comma, semicolon, question mark and full stop.
 */
const TRAILING_PUNCTUATION = ".,;:!?'\"*_…–।॥،؛؟۔";
const isCloser = (ch: string): ch is ")" | "]" | "}" => ch === ")" || ch === "]" || ch === "}";

/**
 * Drops punctuation that ends the sentence rather than the address, and a closing bracket only when the address has more
 * of them than opening ones: "(see https://en.wikipedia.org/wiki/Rust_(language))" keeps the bracket that belongs to it.
 */
function trimUrl(candidate: string): string {
  // Closing brackets beyond the opening ones, counted once so that trimming stays linear.
  const unmatched = { ")": 0, "]": 0, "}": 0 };
  for (const ch of candidate) {
    if (isCloser(ch)) unmatched[ch] += 1;
    else if (ch === "(") unmatched[")"] -= 1;
    else if (ch === "[") unmatched["]"] -= 1;
    else if (ch === "{") unmatched["}"] -= 1;
  }
  let end = candidate.length;
  while (end > 0) {
    const ch = candidate[end - 1]!;
    if (TRAILING_PUNCTUATION.includes(ch)) end -= 1;
    else if (isCloser(ch) && unmatched[ch] > 0) {
      unmatched[ch] -= 1;
      end -= 1;
    } else break;
  }
  return candidate.slice(0, end);
}

/** The host and port as written: what follows "://", up to the path, query or fragment. */
function writtenAuthority(written: string): string {
  const from = written.indexOf("://") + 3;
  let to = from;
  while (to < written.length && !"/?#\\".includes(written[to]!)) to += 1;
  return written.slice(from, to);
}

const isAscii = (text: string) => {
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) > 0x7f) return false;
  return true;
};

/**
 * The address a link may go to: http or https with a host, and no user name or password, so "https://google.com@evil.com"
 * (which goes to evil.com) stays text. Anything `URL` can't parse stays text too.
 *
 * The host must be written in ASCII. A link shows its address as written but goes to `URL`'s punycode, so a host beyond
 * ASCII could show one site and open another: "accounts.google.com⁄signin.evil.net" (a fraction slash, not "/") is a
 * subdomain of evil.net, "аррӏе.com" is Cyrillic, and a right-to-left host can show its path first. Such an address
 * stays text; a path beyond ASCII is fine.
 */
function httpHref(written: string): string | null {
  if (written.length > MAX_LINK_LENGTH || !isAscii(writtenAuthority(written))) return null;
  let url: URL;
  try {
    url = new URL(written);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname || url.username || url.password) return null;
  return url.href.length > MAX_LINK_LENGTH ? null : url.href;
}

const isAsciiLetter = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const isAsciiAlnum = (c: number) => isAsciiLetter(c) || (c >= 48 && c <= 57);
/**
 * Letters, digits and `._+-`: the local part most real addresses use. Not `%`: a mail app decodes the address it's given,
 * so a link shown as "cv%40gmai1.com%2Chr@acme.io" would also send to cv@gmai1.com.
 */
const isLocalChar = (c: number) => isAsciiAlnum(c) || c === 46 || c === 95 || c === 43 || c === 45;
const isDomainChar = (c: number) => isAsciiAlnum(c) || c === 46 || c === 45;

function isEmailDomain(domain: string): boolean {
  if (domain.length > 253) return false;
  const labels = domain.split(".");
  if (labels.length < 2) return false;
  const tld = labels[labels.length - 1]!;
  if (tld.length < 2 || ![...tld].every((ch) => isAsciiLetter(ch.charCodeAt(0)))) return false;
  return labels.every((l) => l.length > 0 && l.length <= 63 && !l.startsWith("-") && !l.endsWith("-"));
}

function mailtoHref(local: string, domain: string): string | null {
  if (!local || local.length > 64 || local.endsWith(".") || local.includes("..") || !isEmailDomain(domain)) return null;
  try {
    const url = new URL(`mailto:${local}@${domain}`);
    return url.protocol === "mailto:" ? url.href : null;
  } catch {
    return null;
  }
}

function pushText(out: RichInline[], text: string) {
  if (!text) return;
  const last = out[out.length - 1];
  if (last?.type === "text") last.text += text;
  else out.push({ type: "text", text });
}

/** Links bare email addresses in text that holds no web address. Each "@" looks outward only as far as the one before it. */
function pushWithEmails(out: RichInline[], segment: string) {
  let done = 0;
  let at = segment.indexOf("@");
  while (at !== -1) {
    let start = at;
    while (start > done && isLocalChar(segment.charCodeAt(start - 1))) start -= 1;
    while (start < at && segment[start] === ".") start += 1;
    let end = at + 1;
    while (end < segment.length && isDomainChar(segment.charCodeAt(end))) end += 1;
    while (end > at + 1 && (segment[end - 1] === "." || segment[end - 1] === "-")) end -= 1;
    const href = mailtoHref(segment.slice(start, at), segment.slice(at + 1, end));
    if (href) {
      pushText(out, segment.slice(done, start));
      out.push({ type: "link", href, text: segment.slice(start, end) });
      done = end;
      at = segment.indexOf("@", end);
    } else {
      at = segment.indexOf("@", at + 1);
    }
  }
  pushText(out, segment.slice(done));
}

/**
 * One line as text and links, with invisible characters removed as `parseRichText` removes them. Web addresses are found
 * first and email addresses only between them, so the two never overlap; an address that fails the checks stays text whole.
 */
export function linkify(line: string): RichInline[] {
  return linkCleanLine(clean(line));
}

function linkCleanLine(line: string): RichInline[] {
  const out: RichInline[] = [];
  let done = 0;
  const pattern = new RegExp(URL_CANDIDATE);
  for (let match = pattern.exec(line); match; match = pattern.exec(line)) {
    pushWithEmails(out, line.slice(done, match.index));
    const candidate = match[0];
    const written = trimUrl(candidate);
    const href = httpHref(written);
    if (href) {
      out.push({ type: "link", href, text: written });
      pushText(out, candidate.slice(written.length));
    } else {
      pushText(out, candidate);
    }
    done = match.index + candidate.length;
  }
  pushWithEmails(out, line.slice(done));
  return out;
}

/** The text of a line or list item, links included. */
export const inlineText = (inlines: RichInline[]) => inlines.map((i) => i.text).join("");

/** Letters of the scripts written right to left: Hebrew, Arabic (with Urdu and Persian), Syriac, Thaana, N'Ko and others. */
const RTL_LETTERS: [number, number][] = [
  [0x05d0, 0x05f2],
  [0x0620, 0x064a],
  [0x066e, 0x06d5],
  [0x06fa, 0x08ff],
  [0xfb1d, 0xfdff],
  [0xfe70, 0xfefe],
];
/** Letters of the common scripts written left to right; digits, punctuation, symbols and emoji are in neither list. */
const LTR_LETTERS: [number, number][] = [
  [0x41, 0x5a],
  [0x61, 0x7a],
  [0xc0, 0xd6],
  [0xd8, 0xf6],
  [0xf8, 0x2af],
  [0x370, 0x58f],
  [0x900, 0x1fff],
  [0x3040, 0x30ff],
  [0x3400, 0x9fff],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xff21, 0xff3a],
  [0xff41, 0xff5a],
];
const inRanges = (c: number, ranges: [number, number][]) => ranges.some(([lo, hi]) => c >= lo && c <= hi);

/**
 * Which way text reads, from its first letter, as a browser decides `dir="auto"`: "rtl" for Hebrew, Arabic or Urdu, "ltr"
 * otherwise, and for text with no letters. The web renders lists with `dir="auto"`; the mobile app has no such thing and
 * lays a list out from this, so the two agree.
 */
export function textDirection(text: string): "ltr" | "rtl" {
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (inRanges(c, RTL_LETTERS)) return "rtl";
    if (inRanges(c, LTR_LETTERS)) return "ltr";
  }
  return "ltr";
}

const SEPARATORS = " ·,;:.-–—";

/**
 * Rich text as one line of at most `max` characters, for cards and previews: blocks run together, list items are joined
 * with " · ", and a cut falls between words where it can, ending in "…".
 */
export function plainExcerpt(text: string | null | undefined, max: number): string {
  const flat = parseRichText(text)
    .map((b) => (b.type === "paragraph" ? b.lines.map(inlineText).join(" ") : b.items.map(inlineText).join(" · ")))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (flat.length <= max) return flat;
  if (max < 1) return "";
  let end = max - 1;
  const code = flat.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  // Cut at the last space unless that would throw away more than half, as one long address would.
  const space = flat.lastIndexOf(" ", end);
  if (space >= end / 2) end = space;
  while (end > 0 && SEPARATORS.includes(flat[end - 1]!)) end -= 1;
  return `${flat.slice(0, end)}…`;
}
