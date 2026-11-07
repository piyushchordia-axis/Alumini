import { formatCount } from "@illuminize/shared";
import { Children, isValidElement, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { FitGrid } from "@/components/FitGrid";
import { IconChevronRight } from "@/components/icons";
import { colors, radius, spacing } from "@/theme";

/** Work waiting, in the web console's amber: the value is about 7:1 on the wash. */
const AMBER = { wash: "#fffbeb", border: "#fcd34d", ink: "#92400e" };

/**
 * One figure of the admin console, as the web's Stat. A count of work waiting (`attention`) is drawn in amber. With
 * `onPress` it's a link into its section. Its accessible name is the label and the count, "Pending members, 2", and
 * the hint is read after it. A null value has no figure to give (a dash, read as "none"). `dense` is a smaller tile,
 * for a summary above a list (in a dense StatGrid).
 */
export function StatTile({ label, value, hint, attention = false, dense = false, onPress }: { label: string; value: number | null; hint?: string; attention?: boolean; dense?: boolean; onPress?: () => void }) {
  const name = `${label}, ${value === null ? "none" : formatCount(value)}`;
  const box = [styles.tile, dense ? styles.denseTile : null, attention ? styles.attention : null];
  const body = (
    <>
      <View style={styles.top}>
        <Text style={[styles.label, dense ? styles.denseLabel : null]}>{label}</Text>
        {onPress && <IconChevronRight size={16} color={colors.faint} />}
      </View>
      <Text style={[styles.value, dense ? styles.denseValue : null, attention ? { color: AMBER.ink } : null]}>{value === null ? "—" : formatCount(value)}</Text>
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

/** What StatGrid reads from its tiles: a StatTile's label and whether it's a link. */
type TileProps = { label?: unknown; onPress?: unknown };

/**
 * Tiles two to a row (three when `dense`), as tall as the tallest in the row, so the figures line up on a phone and
 * nothing scrolls sideways; fewer, down to one, where the longest word of a label wouldn't fit beside the next tile
 * (`FitGrid`). The labels are the tiles' `label` props, or `labels` (at `labelSize`, if not the StatTile's) for tiles
 * that take theirs another way.
 */
export function StatGrid({ dense = false, labels, labelSize, children }: { dense?: boolean; labels?: readonly string[]; labelSize?: number; children: ReactNode }) {
  const tiles = Children.toArray(children).map((tile): TileProps => (isValidElement<TileProps>(tile) ? tile.props : {}));
  const texts = labels ?? tiles.map((tile) => (typeof tile.label === "string" ? tile.label : null));
  // The labels are capitals, spaced out, so wider than most text (em 0.75); beside them the tile's padding and border,
  // and a link's chevron and its gap where a tile is a link.
  const linked = tiles.some((tile) => !!tile.onPress);
  const chrome = 2 * (dense ? spacing.sm : spacing.md) + 2 + (linked ? 16 + spacing.xs : 0);
  return (
    <FitGrid texts={texts} fontSize={labelSize ?? (dense ? 11 : 12)} em={0.75} chrome={chrome} max={dense ? 3 : 2} gap={spacing.sm} rowGap={spacing.sm}>
      {children}
    </FitGrid>
  );
}

const styles = StyleSheet.create({
  tile: { flexGrow: 1, minHeight: 96, gap: 4, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  denseTile: { minHeight: 0, gap: 2, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, borderRadius: radius.md },
  attention: { backgroundColor: AMBER.wash, borderColor: AMBER.border },
  top: { flexDirection: "row", alignItems: "flex-start", gap: spacing.xs },
  label: { flex: 1, fontSize: 12, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase", color: colors.muted },
  value: { fontSize: 24, fontWeight: "700", color: colors.text },
  denseLabel: { fontSize: 11, letterSpacing: 0.3 },
  denseValue: { fontSize: 20, fontVariant: ["tabular-nums"] },
  hint: { fontSize: 12, color: colors.muted },
});
