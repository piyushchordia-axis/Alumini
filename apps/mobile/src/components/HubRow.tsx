import { STATUS_TONES } from "@illuminize/shared";
import { Pressable, Text, View } from "react-native";
import { IconChevronRight, NavIcon, type NavIconName } from "@/components/icons";
import { colors, spacing } from "@/theme";

// The shared status tones, as the web's NavBadge draws them. The edge keeps the amber count's shape on a white row.
const COUNT_TONES = {
  // Something unread: white on the danger solid.
  danger: { bg: STATUS_TONES.danger.solid, fg: "#fff", edge: STATUS_TONES.danger.solid },
  // Work waiting for an admin, in the web console's amber.
  warning: { bg: STATUS_TONES.warning.fill, fg: STATUS_TONES.warning.ink, edge: STATUS_TONES.warning.edge },
};

/**
 * One row of a hub (More, the admin console's home). A count shows beside it, and its accessible name says what it
 * counts, such as "Groups, 2 invitations". `danger` is a destructive row, such as Sign out. `dense` is the console's
 * tighter row, still a 44-point target.
 */
export function HubRow({
  icon,
  label,
  danger,
  count = 0,
  countLabel,
  countTone = "danger",
  dense = false,
  onPress,
}: {
  icon: NavIconName;
  label: string;
  danger?: boolean;
  count?: number;
  countLabel?: string;
  countTone?: keyof typeof COUNT_TONES;
  dense?: boolean;
  onPress: () => void;
}) {
  const tint = danger ? colors.danger : colors.text;
  const tone = COUNT_TONES[countTone];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={count > 0 && countLabel ? countLabel : label}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: dense ? 44 : 48, opacity: pressed ? 0.6 : 1 })}
    >
      <NavIcon name={icon} size={dense ? 18 : 20} color={tint} />
      <Text style={{ flex: 1, fontSize: dense ? 14 : 15, fontWeight: "600", color: tint }}>{label}</Text>
      {count > 0 && (
        <View style={{ minWidth: 20, height: 20, borderRadius: 10, borderWidth: 1, borderColor: tone.edge, backgroundColor: tone.bg, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 }}>
          <Text style={{ color: tone.fg, fontSize: 11, fontWeight: "700" }}>{count > 99 ? "99+" : count}</Text>
        </View>
      )}
      {!danger && <IconChevronRight size={16} color={colors.faint} />}
    </Pressable>
  );
}
