import { formatCount, SERIES, unitFor, type CountRow, type Unit } from "@illuminize/shared";
import { StyleSheet, Text, View } from "react-native";
import { spacing } from "@/theme";

/** Room after each bar for its value, so every bar is drawn to the same scale. */
const VALUE_WIDTH = 52;

/**
 * Ranked horizontal bars with the value at each tip, so no axis is needed. A label wraps to a second line rather than
 * being cut short, so nothing needs a readout, and each row is read as one: "Mumbai, 12 members".
 */
export function HBarChart({
  rows,
  format = formatCount,
  max,
  unit,
  color = SERIES[0],
}: {
  rows: CountRow[];
  format?: (n: number) => string;
  /** The scale's end (100 for percentages); the largest value when not given. */
  max?: number;
  unit: Unit;
  color?: string;
}) {
  const scale = Math.max(1, max ?? Math.max(0, ...rows.map((r) => r.count)));
  return (
    <View role="list" style={styles.list}>
      {rows.map((r, i) => {
        const ratio = Math.min(1, Math.max(0, r.count / scale));
        return (
          <View key={`${r.label}-${i}`} role="listitem" accessible accessibilityLabel={`${r.label}, ${format(r.count)} ${unitFor(unit, r.count)}`} style={styles.row}>
            <Text numberOfLines={2} style={styles.label}>
              {r.label}
            </Text>
            <View style={styles.track}>
              <View style={[styles.bar, { flexGrow: ratio, minWidth: r.count > 0 ? 2 : 0, backgroundColor: color }]} />
              <Text numberOfLines={1} style={styles.value}>
                {format(r.count)}
              </Text>
              <View style={{ flexGrow: 1 - ratio, flexBasis: 0 }} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  label: { flexBasis: "38%", flexShrink: 0, fontSize: 12, lineHeight: 16, color: "#475569" },
  // The bar and the space after it share what's left beside the value, in the bar's ratio.
  track: { flex: 1, flexDirection: "row", alignItems: "center" },
  bar: { flexBasis: 0, height: 14, borderTopRightRadius: 3, borderBottomRightRadius: 3 },
  value: { width: VALUE_WIDTH, paddingLeft: 6, fontSize: 12, fontWeight: "600", color: "#334155", fontVariant: ["tabular-nums"] },
});
