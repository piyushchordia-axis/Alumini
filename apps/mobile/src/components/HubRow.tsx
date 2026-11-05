import { Pressable, Text, View } from "react-native";
import { IconChevronRight, NavIcon, type NavIconName } from "@/components/icons";
import { colors, spacing } from "@/theme";

const COUNT_TONES = {
  danger: { bg: colors.danger, fg: "#fff" },
  // Work waiting for an admin, in the web console's amber.
  warning: { bg: "#fef3c7", fg: "#92400e" },
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
        <View style={{ minWidth: 20, height: 20, borderRadius: 10, backgroundColor: tone.bg, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 }}>
          <Text style={{ color: tone.fg, fontSize: 11, fontWeight: "700" }}>{count > 99 ? "99+" : count}</Text>
        </View>
      )}
      {!danger && <IconChevronRight size={16} color={colors.faint} />}
    </Pressable>
  );
}
