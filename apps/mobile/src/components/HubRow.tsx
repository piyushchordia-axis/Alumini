import { GREYS, STATUS_TONES } from "@illuminize/shared";
import { useId } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { IconChevronRight, NavIcon, type NavIconName } from "@/components/icons";
import { describedBy } from "@/components/ui";
import { colors, radius, spacing } from "@/theme";

// The shared status tones, as the web's NavBadge draws them. The edge keeps the amber count's shape on a white row.
const COUNT_TONES = {
  // Something unread: white on the danger solid.
  danger: { bg: STATUS_TONES.danger.solid, fg: "#fff", edge: STATUS_TONES.danger.solid },
  // Work waiting for an admin, in the web console's amber.
  warning: { bg: STATUS_TONES.warning.fill, fg: STATUS_TONES.warning.ink, edge: STATUS_TONES.warning.edge },
};

/**
 * A count on a navigation row or chip (a HubRow, the feed's Explore row), as the web's NavBadge draws it. Screen readers
 * skip it: the row's or chip's own name says what it counts. It grows with the system text size rather than holding 20
 * points, so a large count stays inside its pill.
 */
export function CountPill({ count, tone = "danger" }: { count: number; tone?: keyof typeof COUNT_TONES }) {
  const { bg, fg, edge } = COUNT_TONES[tone];
  return (
    <View aria-hidden style={[styles.count, { borderColor: edge, backgroundColor: bg }]}>
      <Text style={{ color: fg, fontSize: 11, fontWeight: "700" }}>{count > 99 ? "99+" : count}</Text>
    </View>
  );
}

/**
 * One row of a hub (More, the admin console's home). A count shows beside it, and its accessible name says what it
 * counts, such as "Groups, 2 invitations". `danger` is a destructive row, such as Sign out. `dense` is the console's
 * tighter row, still a 44-point target. With a `description` it's a described row, as More's are: its icon in a well and
 * the line under its name, read after the name (the hint on a phone, aria-describedby in the browser build).
 */
export function HubRow({
  icon,
  label,
  description,
  danger,
  count = 0,
  countLabel,
  countTone = "danger",
  dense = false,
  onPress,
}: {
  icon: NavIconName;
  label: string;
  description?: string;
  danger?: boolean;
  count?: number;
  countLabel?: string;
  countTone?: keyof typeof COUNT_TONES;
  dense?: boolean;
  onPress: () => void;
}) {
  const descriptionId = useId();
  const tint = danger ? colors.danger : colors.text;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={count > 0 && countLabel ? countLabel : label}
      accessibilityHint={description}
      {...(description ? describedBy(descriptionId) : {})}
      style={({ pressed }) => [styles.row, description ? styles.described : { minHeight: dense ? 44 : 48 }, { opacity: pressed ? 0.6 : 1 }]}
    >
      {description ? (
        <View style={styles.well}>
          <NavIcon name={icon} size={20} color={GREYS.body} />
        </View>
      ) : (
        <NavIcon name={icon} size={dense ? 18 : 20} color={tint} />
      )}
      <View style={styles.text}>
        <Text style={{ fontSize: dense ? 14 : 15, fontWeight: "600", color: tint }}>{label}</Text>
        {description ? (
          <Text nativeID={descriptionId} style={styles.description}>
            {description}
          </Text>
        ) : null}
      </View>
      {count > 0 && <CountPill count={count} tone={countTone} />}
      {!danger && <IconChevronRight size={16} color={colors.faint} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  // Taller than a plain row, so a line that wraps at a large text size still has room.
  described: { minHeight: 56, paddingVertical: spacing.xs },
  // Slate-100 under a slate-700 icon, as the web's More sheet draws it.
  well: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: STATUS_TONES.neutral.fill, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, minWidth: 0 },
  description: { fontSize: 13, lineHeight: 18, color: colors.muted, marginTop: 1 },
  count: { minWidth: 20, minHeight: 20, borderRadius: radius.full, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
});
