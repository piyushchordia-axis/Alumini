import { CHART_EMPTY_TEXT, type ChartTableData, type LegendItem } from "@illuminize/shared";
import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Card, headingRole, toggleState } from "@/components/ui";
import { colors, radius, spacing } from "@/theme";
import { ChartTable } from "./ChartTable";

/**
 * One chart: its heading and subtitle, a legend when it draws two or more series, and a Table switch, so every value
 * can be read without scrubbing. The switch keeps its name and says whether it's on (pressed), as on the web.
 */
export function ChartCard({
  title,
  subtitle,
  legend,
  table,
  empty = false,
  emptyText = CHART_EMPTY_TEXT,
  children,
}: {
  title: string;
  subtitle?: string;
  legend?: LegendItem[];
  table: ChartTableData;
  empty?: boolean;
  emptyText?: string;
  children: ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);
  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <View style={styles.titles}>
          <Text {...headingRole(3)} style={styles.title}>
            {title}
          </Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {!empty && (
          <Pressable
            onPress={() => setShowTable((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel="Table"
            accessibilityHint={showTable ? `Shows ${title} as a chart again` : `Shows ${title} as a table`}
            {...toggleState(showTable)}
            style={({ pressed }) => [styles.toggle, showTable ? styles.toggleOn : null, pressed ? { opacity: 0.7 } : null]}
          >
            <Text style={[styles.toggleText, showTable ? styles.toggleTextOn : null]}>Table</Text>
          </Pressable>
        )}
      </View>
      {legend && legend.length >= 2 && !showTable && !empty && (
        <View role="list" aria-label="Legend" style={styles.legend}>
          {legend.map((l) => (
            <View key={l.label} role="listitem" style={styles.legendItem}>
              <View aria-hidden style={[l.kind === "line" ? styles.keyLine : styles.keyBlock, { backgroundColor: l.color }]} />
              <Text style={styles.legendText}>{l.label}</Text>
            </View>
          ))}
        </View>
      )}
      {empty ? <Text style={styles.empty}>{emptyText}</Text> : showTable ? <ChartTable title={title} table={table} /> : children}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  header: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  titles: { flex: 1, gap: 2 },
  title: { fontSize: 14, fontWeight: "700", color: colors.text },
  subtitle: { fontSize: 12, lineHeight: 16, color: colors.muted },
  // A full 44-point target, drawn smaller.
  toggle: { minHeight: 44, minWidth: 44, justifyContent: "center", alignItems: "center", paddingHorizontal: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  toggleOn: { backgroundColor: "#f1f5f9", borderColor: colors.borderStrong },
  toggleText: { fontSize: 13, fontWeight: "600", color: "#475569" },
  toggleTextOn: { color: colors.text },
  legend: { flexDirection: "row", flexWrap: "wrap", columnGap: spacing.lg, rowGap: spacing.xs },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  keyLine: { width: 16, height: 2, borderRadius: 1 },
  keyBlock: { width: 10, height: 10, borderRadius: 2 },
  legendText: { fontSize: 12, color: "#475569" },
  empty: { paddingVertical: spacing.xl, textAlign: "center", fontSize: 14, color: colors.muted },
});
