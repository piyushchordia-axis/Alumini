/**
 * Colour arithmetic for an institution's brand colour: WCAG 2 contrast, and the tones both apps derive from it. Written
 * by hand, with no Intl and no dependency, so the phone app (Hermes) runs the same code as the web app. Colours are
 * "#rrggbb", as `hexColorSchema` stores them.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const WHITE = "#ffffff";
const BLACK = "#000000";
/** The apps' text colour. Inks darken toward it rather than toward black, which looks muddy next to it. */
const SLATE_900 = "#0f172a";
/** The apps' secondary text, and the plain page it has to stay readable on. */
const SLATE_500 = "#64748b";
const PLAIN_PAGE = "#f1f5f9";
/** The default institution colour, used when a stored one can't be read, as both apps' themes do. */
const FALLBACK_PRIMARY = "#1d4ed8";
/** inkOn darkens in steps of 1/INK_STEPS of the way to slate-900, so an ink keeps as much of the brand as it can. */
const INK_STEPS = 50;
/** WCAG 2 contrast for text, and for icons and other graphics. */
const TEXT_CONTRAST = 4.5;
const ICON_CONTRAST = 3;
/** The share of the brand in the soft tint a badge sits on: mobile `primarySoft` (12%), web `bg-primary/10`. */
const SOFT_TINT = 0.12;

/** "#rrggbb" (the # optional, any case) as channels from 0 to 255; null for anything else, "#fff" included. */
export function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Channels as "#rrggbb", each rounded and kept within 0 to 255. */
export function toHex({ r, g, b }: Rgb): string {
  const part = (v: number) =>
    Math.round(Math.min(255, Math.max(0, v)))
      .toString(16)
      .padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

function rgbOf(hex: string): Rgb {
  const rgb = parseHex(hex);
  if (!rgb) throw new RangeError(`Not a #rrggbb colour: ${hex}`);
  return rgb;
}

/** `weightA` of `a` mixed with the rest of `b` (0 gives `b`, 1 gives `a`): how `a` at that opacity looks over `b`. */
export function mixHex(a: string, b: string, weightA: number): string {
  const x = rgbOf(a);
  const y = rgbOf(b);
  const w = Math.min(1, Math.max(0, weightA));
  const mix = (p: number, q: number) => p * w + q * (1 - w);
  return toHex({ r: mix(x.r, y.r), g: mix(x.g, y.g), b: mix(x.b, y.b) });
}

const linear = (channel: number) => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** WCAG 2 relative luminance: 0 for black, 1 for white. */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = rgbOf(hex);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG 2 contrast ratio, from 1 to 21. Text needs 4.5; icons and other graphics, and large text, need 3. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * `color` darkened toward slate-900 only as far as it takes to reach `min` contrast with `bg`, a light background. A colour
 * that already does comes back as it is. On a background too dark for that, it gives the step with the most contrast.
 */
export function inkOn(color: string, bg = WHITE, min = TEXT_CONTRAST): string {
  let best = toHex(rgbOf(color));
  let bestRatio = contrastRatio(best, bg);
  for (let step = 0; step <= INK_STEPS; step++) {
    const ink = mixHex(SLATE_900, color, step / INK_STEPS);
    const ratio = contrastRatio(ink, bg);
    if (ratio >= min) return ink;
    if (ratio > bestRatio) {
      best = ink;
      bestRatio = ratio;
    }
  }
  return best;
}

/**
 * The text on a button or chip filled with the brand colour: white or slate-900, whichever reads better on `bg`. On the
 * few mid-tone colours where neither reaches 4.5:1 (slate-900 is lighter than black), black or white instead.
 */
export function onColor(bg: string): string {
  const white = contrastRatio(WHITE, bg);
  const slate = contrastRatio(SLATE_900, bg);
  if (Math.max(white, slate) >= TEXT_CONTRAST) return white >= slate ? WHITE : SLATE_900;
  return contrastRatio(BLACK, bg) > white ? BLACK : WHITE;
}

export interface BrandTones {
  /**
   * The brand colour as text or a chosen icon, darkened only where it has to be: to 4.5:1 on white, on the plain page
   * and on the brand's soft tint (a reaction count, a ghost button, a badge), and to 3:1 on `wash` (the icon of
   * something chosen). Most brands keep their colour; a light one gets a darker shade.
   */
  ink: string;
  /** A light tint (14% of the ink on white) behind something chosen, such as the member's reaction. */
  wash: string;
  /** A stronger tint (45% of the ink), for the thin ring around the wash. */
  ring: string;
  /** Text on the brand colour itself: white, or near-black on a light brand. */
  onPrimary: string;
}

/**
 * The tones of an institution colour. One that can't be read gives the default institution colour's. The wash and the
 * ring come from the ink, not the raw brand: a pale brand's own tints are no darker than the tray a chosen chip sits
 * in, so the chip would look unchosen. For a brand that reads as it is, the ink is the brand, so nothing changes.
 */
export function brandTones(primary: string): BrandTones {
  const brand = parseHex(primary) ? primary : FALLBACK_PRIMARY;
  const text = inkOn(inkOn(brand, PLAIN_PAGE, TEXT_CONTRAST), mixHex(brand, WHITE, SOFT_TINT), TEXT_CONTRAST);
  const wash = mixHex(text, WHITE, 0.14);
  return {
    ink: inkOn(text, wash, ICON_CONTRAST),
    wash,
    ring: mixHex(text, WHITE, 0.45),
    onPrimary: onColor(brand),
  };
}

/**
 * `base` with as much of the brand colour mixed in, up to 8%, as keeps slate-500 text on it at least as readable as on
 * the plain page (#f1f5f9, about 4.34:1), so a page tinted with the brand is never harder to read than a plain one.
 */
export function pageTint(primary: string, base = "#f8fafc"): string {
  const brand = parseHex(primary) ? primary : FALLBACK_PRIMARY;
  const floor = contrastRatio(SLATE_500, PLAIN_PAGE);
  for (let percent = 8; percent > 0; percent -= 0.5) {
    const tint = mixHex(brand, base, percent / 100);
    if (contrastRatio(SLATE_500, tint) >= floor) return tint;
  }
  return toHex(rgbOf(base));
}
