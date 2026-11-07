import { longestWordLength, wordColumnWidth } from "@illuminize/shared";

/**
 * A grid's columns for text laid side by side: up to `max` across, each at least as wide as the longest word in `texts`
 * at `fontSize` plus `chrome` (all in rem), so a narrow phone or large text gets fewer columns, down to one, rather
 * than words broken mid-word. Spread over a `grid` element's style; a cell still needs `min-w-0` and `break-words`
 * for a word wider than the whole row.
 *
 * Within `minmax`, `(100% - gaps) / max` stops more than `max` columns fitting, and `min(100%, …)` stops a column ever
 * being wider than the grid. The text's own size scales with the browser's, as rem does, so large text gets fewer
 * columns too.
 */
export function fitColumns(
  texts: Iterable<string | null | undefined>,
  { fontSize = 0.875, chrome = 0, em, max = 2, gap = 1 }: { fontSize?: number; chrome?: number; em?: number; max?: number; gap?: number } = {},
): { columnGap: string; gridTemplateColumns: string } {
  const width = Math.round(wordColumnWidth(longestWordLength(texts), fontSize, { chrome, em }) * 100) / 100;
  return {
    columnGap: `${gap}rem`,
    gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, max(${width}rem, (100% - ${(max - 1) * gap}rem) / ${max})), 1fr))`,
  };
}
