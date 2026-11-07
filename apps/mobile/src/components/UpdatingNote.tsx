import { UPDATING_RESULTS } from "@illuminize/shared";
import { useEffect } from "react";
import { AccessibilityInfo, Platform, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { colors, elevation, radius, spacing } from "@/theme";

/**
 * "Updating results…" on the top edge of a list whose rows are kept from the search before while this one's answer
 * comes (useInfiniteList's `updating`), as the web's sits: centred on the first row's top edge, half over the space
 * above it. Put it last in the box just above the rows, raised over them: the search box's or the filters' above a
 * list (`zIndex: 1` on that box), or a FlatList's header (`ListHeaderComponentStyle={{ zIndex: 1 }}`), with `gap` the
 * space between that header and the first row (the content's gap). It floats, taking no room and no touches, so
 * nothing moves and the rows stay tappable. Always mounted, so Android's live region and the web build's status read it
 * out when it appears; iOS has no live regions, so it is told, as the console's Analytics does.
 */
export function UpdatingNote({ updating, gap = 0 }: { updating: boolean; gap?: number }) {
  useEffect(() => {
    if (updating && Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(UPDATING_RESULTS);
  }, [updating]);
  return (
    <View role="status" accessibilityLiveRegion={Platform.OS === "android" ? "polite" : undefined} style={[styles.slot, { transform: [{ translateY: gap }, { translateY: "-50%" }] }]}>
      {updating ? (
        <View style={styles.pill}>
          <Text style={styles.text}>{UPDATING_RESULTS}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** A row kept from the search before, faded while the new answer comes. It stays tappable: it only opens a page. */
export const KEPT_ROW: ViewStyle = { opacity: 0.6 };

const styles = StyleSheet.create({
  // From the foot of the box it's in, `gap` further down: the first row's top edge.
  slot: { position: "absolute", top: "100%", left: 0, right: 0, alignItems: "center", pointerEvents: "none" },
  pill: { backgroundColor: colors.card, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, ...elevation[1] },
  text: { fontSize: 12, color: colors.secondary },
});
