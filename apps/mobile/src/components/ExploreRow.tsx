import { EXPLORE_TITLE } from "@illuminize/shared";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { CountPill } from "@/components/HubRow";
import { NavIcon } from "@/components/icons";
import { headingRole } from "@/components/ui";
import { useMemberSections } from "@/hooks/useMemberSections";
import { colors, elevation, radius, spacing, useTheme } from "@/theme";

/**
 * The feed's shortcuts to the sections behind More, in priority order (the bar's, continued: More groups them under
 * Connect and Community) and with More's badges, so a member sees what else is here without opening it: the web's phone
 * feed has the same row. The chips wrap rather than scroll, so none is out of sight. A labelled region of links, never a
 * second set of tabs, and nothing at all when there's nothing behind More. Each opens its section as More's row does.
 */
export function ExploreRow() {
  const router = useRouter();
  const theme = useTheme();
  const { overflow, toLink, badgeFor } = useMemberSections();
  if (overflow.length === 0) return null;
  return (
    <View role="region" aria-label={EXPLORE_TITLE} style={styles.region}>
      {/* On the page, but dark enough to read on any background a member picks. */}
      <Text {...headingRole(2)} style={styles.heading}>
        {EXPLORE_TITLE}
      </Text>
      <View role="list" style={styles.chips}>
        {overflow.map((section) => {
          const { label, icon, href } = toLink(section);
          const badge = badgeFor(section);
          return (
            <View key={section} role="listitem">
              {/* Named as More's row is, so it says what the badge counts ("Groups, 1 invitation"). */}
              <Pressable onPress={() => router.push(href)} accessibilityRole="link" accessibilityLabel={badge?.label ?? label} style={({ pressed }) => [styles.chip, pressed ? styles.pressed : null]}>
                <NavIcon name={icon} size={18} color={theme.primaryInk} />
                <Text style={styles.label}>{label}</Text>
                {badge ? <CountPill count={badge.count} /> : null}
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  region: { gap: spacing.sm },
  heading: { fontSize: 14, fontWeight: "700", color: colors.text, paddingHorizontal: spacing.xs },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  // A level-1 surface, white on whatever background the member picked, and a full 44-point target.
  chip: { ...elevation[1], flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44, paddingLeft: spacing.md, paddingRight: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.full, backgroundColor: colors.card },
  pressed: { backgroundColor: colors.bg },
  label: { fontSize: 14, fontWeight: "600", color: colors.text, flexShrink: 1 },
});
