/** Halves of surrogate pairs on their own, which encodeURIComponent throws on. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
/** Control characters (a line break would end the header) and invisible format ones (a right-to-left override can disguise an extension). */
const HIDDEN = /[\p{Cc}\p{Cf}]/gu;

/** RFC 8187's ext-value: UTF-8, percent-encoded, keeping only its attr-chars. */
function extValue(name: string): string {
  return encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * The name in printable ASCII for clients that ignore `filename*`: accents dropped where the letter survives them, and
 * anything else, the quote, the backslash and `%` (which some browsers decode) as "_".
 */
function asciiFallback(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\x20-\x7e]|["\\%]/g, "_");
}

/**
 * A Content-Disposition header (RFC 6266) for a file name in any script: an ASCII `filename` and the exact name as UTF-8
 * in `filename*`, which every current browser prefers. Nothing in the name can end the header or add a parameter.
 */
export function contentDisposition(type: "inline" | "attachment", fileName?: string | null): string {
  const name = (fileName ?? "").replace(LONE_SURROGATE, "\uFFFD").replace(HIDDEN, "").trim();
  if (!name) return type;
  return `${type}; filename="${asciiFallback(name)}"; filename*=UTF-8''${extValue(name)}`;
}
