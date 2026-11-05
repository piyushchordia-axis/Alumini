import { formatCount } from "@illuminize/shared";
import { Children, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { IconChevronRight } from "@/components/icons";
import { colors, radius, spacing } from "@/theme";

/** Work waiting, in the web console's amber: the value is about 7:1 on the wash. */
const AMBER = { wash: "#fffbeb", border: "#fcd34d", ink: "#92400e" };

/**
 * One figure of the admin console, as the web's Stat. A count of work waiting (`attention`) is drawn in amber. With
 * `onPress` it's a link into its section. Its accessible name is the label and the count, "Pending members, 2", and
 * the hint is read after it.
 */
export function StatTile({ label, value, hint, attention = false, onPress }: { label: string; value: number; hint?: string; attention?: boolean; onPress?: () => void }) {
  const name = `${label}, ${formatCount(value)}`;
  const box = [styles.tile, attention ? styles.attention : null];
  const body = (
    <>
      <View style={styles.top}>
        <Text style={styles.label}>{label}</Text>
        {onPress && <IconChevronRight size={16} color={colors.faint} />}
      </View>
      <Text style={[styles.value, attention ? { color: AMBER.ink } : null]}>{formatCount(value)}</Text>
      {hint ? (
        <Text numberOfLines={2} style={styles.hint}>
          {hint}
        </Text>
      ) : null}
    </>
  );
  if (onPress) {
    return (
      <Pressable onPress={onPress} accessibilityRole="link" accessibilityLabel={name} accessibilityHint={hint} style={({ pressed }) => [...box, pressed ? { opacity: 0.85 } : null]}>
        {body}
      </Pressable>
    );
  }
  return (
    <View accessible accessibilityLabel={name} accessibilityHint={hint} style={box}>
      {body}
    </View>
  );
}

/** Tiles two to a row, as tall as the taller of the two, so the figures line up on a phone and nothing scrolls sideways. */
export function StatGrid({ children }: { children: ReactNode }) {
  return <View style={styles.grid}>{Children.map(children, (tile) => <View style={styles.cell}>{tile}</View>)}</View>;
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  cell: { flexBasis: "40%", flexGrow: 1 },
  tile: { flexGrow: 1, minHeight: 96, gap: 4, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  attention: { backgroundColor: AMBER.wash, borderColor: AMBER.border },
  top: { flexDirection: "row", alignItems: "flex-start", gap: spacing.xs },
  label: { flex: 1, fontSize: 12, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase", color: colors.muted },
  value: { fontSize: 24, fontWeight: "700", color: colors.text },
  hint: { fontSize: 12, color: colors.muted },
});
