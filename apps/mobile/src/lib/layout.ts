import { longestWordLength, wordColumnWidth } from "@illuminize/shared";

/** A FitGrid cell's style: plain values, so it needs no React Native import (the API's unit tests run it). */
export interface FitCellStyle {
  flexBasis: number;
  flexGrow: number;
  maxWidth: "100%";
  minWidth: `${number}%`;
}

/**
 * The style of each cell in a wrapping row of text laid side by side (`FitGrid`): its basis is the longest word in
 * `texts` at `fontSize`, scaled by the phone's text size (`fontScale`), plus `chrome`, so a cell never starts narrower
 * than that word and the row wraps to fewer columns, down to one, instead of breaking it. The cells of a row then grow
 * alike, so they line up as columns.
 *
 * `minWidth` caps the columns at `max` without measuring the row (and so with no first frame drawn wrong): just over a
 * share of `max + 1` (34% for two, 26% for three) leaves no room for one more. `maxWidth` keeps a word wider than the
 * whole row inside it, where the text wraps as best it can.
 */
export function fitCellStyle(
  texts: Iterable<string | null | undefined>,
  { fontSize, fontScale = 1, chrome = 0, em, max = 2 }: { fontSize: number; fontScale?: number; chrome?: number; em?: number; max?: number },
): FitCellStyle {
  return {
    flexBasis: wordColumnWidth(longestWordLength(texts), fontSize * fontScale, { chrome, em }),
    flexGrow: 1,
    maxWidth: "100%",
    minWidth: `${Math.floor(100 / (max + 1)) + 1}%`,
  };
}

/**
 * What the phone's `Choice` (components/ui.tsx) draws around its label, in points: its padding (spacing.md) and border
 * each side, its box (`ChoiceMark`), the gap (spacing.sm) between the box and the label, and the label's size. Plain
 * numbers here, so the API's unit tests size a `Choice fit` chip from the same ones the component draws.
 */
export const CHOICE_SIZES = { paddingX: 12, border: 1, mark: 20, gap: 8, fontSize: 14 } as const;

/** How much wider a `Choice` is than its label: the padding and border each side, the box and the gap. */
export const CHOICE_CHROME = 2 * CHOICE_SIZES.paddingX + 2 * CHOICE_SIZES.border + CHOICE_SIZES.mark + CHOICE_SIZES.gap;
