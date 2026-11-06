import type { DeltaDirection, DeltaView, KpiTile } from "@illuminize/shared";
import type { ComponentType } from "react";
import { StyleSheet, Text, View } from "react-native";
import { IconTrendDown, IconTrendFlat, IconTrendUp, type IconProps } from "@/components/icons";
import { colors, radius, spacing } from "@/theme";

const TREND_ICONS: Record<Exclude<DeltaDirection, "none">, ComponentType<IconProps>> = { up: IconTrendUp, down: IconTrendDown, flat: IconTrendFlat };

/**
 * "+12% vs the previous 12 weeks (10)", with an arrow beside it. The text says the direction itself, so neither the
 * arrow nor a colour is the only sign of it.
 */
export function Delta({ delta }: { delta: DeltaView }) {
  const Trend = delta.direction === "none" ? null : TREND_ICONS[delta.direction];
  return (
    <View style={styles.delta}>
      {Trend && (
        <View aria-hidden style={styles.trend}>
          <Trend size={14} color={colors.muted} />
        </View>
      )}
      <Text style={styles.hint}>{delta.text}</Text>
    </View>
  );
}

/**
 * A headline figure of the Analytics page, drawn as the console's other tiles. Its name says it all: the label and value,
 * then the hint, which for a compared figure is how it changed ("New members, 12. +20% vs the previous 12 weeks (10)").
 * The change is in the name, not an accessibility hint, as hints are optional output (VoiceOver's Speak Hints, TalkBack's
 * usage hints, and none on the web build), and the arrow beside it is hidden from screen readers.
 */
export function Kpi({ tile }: { tile: KpiTile }) {
  return (
    <View accessible accessibilityLabel={`${tile.label}, ${tile.valueText}. ${tile.hint}`} style={styles.tile}>
      <Text style={styles.label}>{tile.label}</Text>
      <Text style={styles.value}>{tile.valueText}</Text>
      {tile.delta ? <Delta delta={tile.delta} /> : <Text style={styles.hint}>{tile.hint}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { flexGrow: 1, minHeight: 96, gap: 4, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  label: { fontSize: 11, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase", color: colors.muted },
  value: { fontSize: 22, fontWeight: "700", color: colors.text, fontVariant: ["tabular-nums"] },
  delta: { flexDirection: "row", alignItems: "flex-start", gap: 4 },
  trend: { marginTop: 1 },
  hint: { flexShrink: 1, fontSize: 12, lineHeight: 16, color: colors.muted },
});
