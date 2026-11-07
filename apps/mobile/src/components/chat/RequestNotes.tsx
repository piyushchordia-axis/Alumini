import type { RerequestLine } from "@illuminize/shared/chat";
import { Text, View } from "react-native";
import { IconClock } from "@/components/icons";
import { colors, spacing } from "@/theme";

/** A thread footer's line saying when a request can be sent again, on a line of its own with the date picked out, as on the web. One sentence to a screen reader. */
export function RerequestWhen({ when }: { when: RerequestLine }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, marginTop: spacing.xs }}>
      <View aria-hidden style={{ paddingTop: 2 }}>
        <IconClock size={16} color={colors.muted} />
      </View>
      <Text style={{ flexShrink: 1, fontSize: 14, color: colors.text }}>
        {when.lead}
        <Text style={{ fontWeight: "700" }}>{when.at}</Text>
        {when.tail}
      </Text>
    </View>
  );
}
