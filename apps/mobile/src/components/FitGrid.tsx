import { Children, isValidElement, type ReactNode } from "react";
import { useWindowDimensions, View } from "react-native";
import { fitCellStyle } from "@/lib/layout";
import { spacing } from "@/theme";

/**
 * Text laid side by side, up to `max` across, as many as leave room for the longest word in `texts` at `fontSize` and
 * the phone's text size, plus `chrome` (an icon and its gap, a tile's padding): a narrow phone or large text gets fewer
 * columns, down to one, rather than a word broken in two. Each child is a cell; the cells of a row grow alike and
 * stretch to its height. With `label` it's a list of that name, each cell an item. It paints nothing, so whatever it
 * sits on shows through.
 */
export function FitGrid({
  texts,
  fontSize,
  chrome,
  em,
  max = 2,
  gap = spacing.md,
  rowGap = spacing.md,
  label,
  children,
}: {
  texts: Iterable<string | null | undefined>;
  fontSize: number;
  chrome?: number;
  em?: number;
  max?: number;
  gap?: number;
  rowGap?: number;
  label?: string;
  children: ReactNode;
}) {
  const { fontScale } = useWindowDimensions();
  const cell = fitCellStyle(texts, { fontSize, fontScale, chrome, em, max });
  return (
    <View role={label ? "list" : undefined} aria-label={label} style={{ flexDirection: "row", flexWrap: "wrap", columnGap: gap, rowGap }}>
      {Children.toArray(children).map((child, i) => (
        <View key={isValidElement(child) && child.key !== null ? child.key : i} role={label ? "listitem" : undefined} style={cell}>
          {child}
        </View>
      ))}
    </View>
  );
}
