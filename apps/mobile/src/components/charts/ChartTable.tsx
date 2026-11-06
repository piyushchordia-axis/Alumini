import { tableCellText, type ChartTableData } from "@illuminize/shared";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing } from "@/theme";

/** A chart's table as tall as this at most, scrolling inside the page: a year of weeks is 53 rows. */
const MAX_HEIGHT = 288;
/** The narrowest a figure column is drawn, so a column of single digits still reads as one. */
const MIN_FIGURE = 36;
/** The first column's least width: its widest name up to this, past which names wrap rather than push the figures out. */
const MAX_FIRST = 112;
const PAD = spacing.md;
const GAP = spacing.sm;

/**
 * Every value of a chart as a table: the first column names the row, and the figures are right-aligned in tabular
 * digits so they line up. Its header stays at the top while a long table scrolls inside the page.
 *
 * Each figure column is as wide as its widest text (its header, mostly), measured out of sight, so a header such as
 * "Comments" is never broken inside the word and every row's figures line up under it; the first column takes the rest.
 * Where the columns don't fit (Activity's five on a narrow phone, or with larger text), the table scrolls sideways inside
 * its frame rather than the page.
 */
export function ChartTable({ title, table }: { title: string; table: ChartTableData }) {
  const [frame, setFrame] = useState(0);
  const [measured, setMeasured] = useState<Readonly<Record<string, number>>>({});
  const keys = table.columns.map((c, j) => `${j}:${c}`);
  const widths = keys.map((k) => measured[k]);
  const ready = frame > 0 && widths.every((w) => w !== undefined);
  const figures = widths.slice(1).map((w) => Math.max(w ?? 0, MIN_FIGURE));
  const firstMin = Math.min(widths[0] ?? 0, MAX_FIRST);
  const width = Math.max(frame, 2 * PAD + GAP * (keys.length - 1) + firstMin + figures.reduce((a, b) => a + b, 0));
  const column = (j: number) => (j === 0 ? [styles.first, { minWidth: firstMin }] : [styles.figure, { width: figures[j - 1] }]);
  const measure = (key: string, w: number) => {
    // Rounded up, and a point over: Android can wrap a text laid out at exactly its measured width.
    const at = Math.ceil(w) + 1;
    setMeasured((m) => (m[key] === at ? m : { ...m, [key]: at }));
  };
  return (
    <View role="table" aria-label={title} style={styles.frame}>
      {table.columns.map((c, j) => (
        <View key={keys[j]} aria-hidden pointerEvents="none" style={styles.measure} onLayout={(e) => measure(keys[j]!, e.nativeEvent.layout.width)}>
          <Text style={[styles.text, styles.headText]}>{c}</Text>
          {table.rows.map((r, i) => (
            <Text key={i} style={[styles.text, j > 0 ? styles.digits : null]}>
              {tableCellText(r[j] ?? "")}
            </Text>
          ))}
        </View>
      ))}
      <ScrollView horizontal nestedScrollEnabled alwaysBounceHorizontal={false} onLayout={(e) => setFrame(Math.floor(e.nativeEvent.layout.width))}>
        {ready && (
          <ScrollView style={[styles.scroll, { width }]} nestedScrollEnabled stickyHeaderIndices={[0]}>
            <View role="row" style={[styles.row, styles.head]}>
              {table.columns.map((c, j) => (
                <Text key={c} role="columnheader" style={[styles.text, styles.cell, styles.headText, ...column(j)]}>
                  {c}
                </Text>
              ))}
            </View>
            {table.rows.map((r, i) => (
              <View key={i} role="row" style={[styles.row, styles.divided]}>
                {r.map((cell, j) => (
                  <Text key={j} role="cell" style={[styles.text, styles.cell, j > 0 ? styles.digits : null, ...column(j)]}>
                    {tableCellText(cell)}
                  </Text>
                ))}
              </View>
            ))}
          </ScrollView>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: "hidden" },
  // Each column's texts as one invisible stack, as wide as the widest of them.
  measure: { position: "absolute", left: 0, top: 0, alignItems: "flex-start", opacity: 0 },
  scroll: { maxHeight: MAX_HEIGHT },
  row: { flexDirection: "row", alignItems: "center", gap: GAP, paddingHorizontal: PAD, minHeight: 32 },
  head: { backgroundColor: "#f8fafc" },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.card },
  text: { fontSize: 12, color: "#334155" },
  cell: { paddingVertical: 6 },
  headText: { fontWeight: "600", color: colors.muted },
  digits: { fontVariant: ["tabular-nums"] },
  first: { flex: 1, textAlign: "left" },
  figure: { flexShrink: 0, textAlign: "right" },
});
