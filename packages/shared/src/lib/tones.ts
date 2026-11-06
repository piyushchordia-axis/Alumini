import type { StatusTone } from "../constants";

/**
 * The greys both apps draw text and lines in, darkest first, each with one job. The web app redraws Tailwind's
 * slate-500 and slate-400 as `meta` and `faint` (index.css), so `text-slate-500` there is the meta grey; the phone's
 * `colors` take them by name. Contrast is pinned in tones.test.ts.
 */
export const GREYS: Readonly<Record<"text" | "body" | "secondary" | "meta" | "faint", string>> = {
  /** Main text. */
  text: "#0f172a",
  /** Labels. */
  body: "#334155",
  /**
   * Excerpts, and every grey on a tinted surface (an unread row, the page on a brand tint or over a photo): 4.5:1 on any
   * brand's wash or tint.
   */
  secondary: "#475569",
  /** Times, places, counts, bylines, hints and placeholders: 5.44:1 on white, 4.97 on the plain page. */
  meta: "#5b6b80",
  /** Icons, control borders and the neutral tag edge, never text: 3.9:1 on white, 3.56 on the plain page. */
  faint: "#748297",
};

export type ToneName = StatusTone | "info";

export interface Tone {
  /** A tag's or a notice's background. */
  fill: string;
  /** Its 1px edge, 3:1 on white and the page, so the tag keeps its shape where the fill doesn't show (forced colours). */
  edge: string;
  /** Text and icons on the fill, on white and on the page: 4.5:1 on each. */
  ink: string;
  /** A solid block under white text (a toast, a count): 4.5:1. */
  solid: string;
}

/** The status colours both apps draw tags, notices, toasts and counts in, so a tag looks the same on the web and the phone. */
export const STATUS_TONES: Readonly<Record<ToneName, Tone>> = {
  neutral: { fill: "#f1f5f9", edge: GREYS.faint, ink: GREYS.body, solid: GREYS.secondary },
  success: { fill: "#d1fae5", edge: "#059669", ink: "#065f46", solid: "#047857" },
  warning: { fill: "#fef3c7", edge: "#b45309", ink: "#92400e", solid: "#b45309" },
  danger: { fill: "#fee2e2", edge: "#dc2626", ink: "#991b1b", solid: "#dc2626" },
  info: { fill: "#e0f2fe", edge: "#0284c7", ink: "#075985", solid: "#0369a1" },
};
