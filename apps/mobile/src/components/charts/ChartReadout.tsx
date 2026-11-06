import type { ReadoutRow } from "@illuminize/shared";
import { StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "@/theme";

/**
 * The category a chart has chosen, on a line above the plot, where a finger can't cover it as it would a box floating
 * over the marks: "Week of 2 Nov 2026 · 3 approved". With several series the title has a line of its own and each
 * series' value follows with its colour key, so the plot below doesn't jump as a longer week name wraps them. Screen
 * readers skip it, as the chart itself says the same as its value.
 */
export function ChartReadout({ title, rows }: { title: string; rows: readonly ReadoutRow[] }) {
  const several = rows.length > 1;
  const values = rows.map((r) => (
    <View key={r.label} style={styles.row}>
      {r.color ? <View style={[styles.key, { backgroundColor: r.color }]} /> : null}
      <Text style={styles.text}>
        <Text style={styles.value}>{r.value}</Text> {r.label}
      </Text>
    </View>
  ));
  return (
    <View aria-hidden style={several ? styles.stacked : styles.line}>
      <Text style={styles.title}>{title}</Text>
      {several ? <View style={styles.line}>{values}</View> : values}
    </View>
  );
}

const styles = StyleSheet.create({
  line: { minHeight: 28, flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: spacing.md, rowGap: 2 },
  stacked: { gap: 2 },
  title: { fontSize: 12, color: colors.muted },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  key: { width: 12, height: 2, borderRadius: 1 },
  text: { fontSize: 12, color: "#475569" },
  value: { fontWeight: "700", color: colors.text, fontVariant: ["tabular-nums"] },
});
