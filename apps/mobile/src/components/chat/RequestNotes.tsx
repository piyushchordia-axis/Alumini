import type { FirstMessageNotice, RerequestLine } from "@illuminize/shared/chat";
import { Text, View } from "react-native";
import { IconClock, IconMail } from "@/components/icons";
import { EmptyIcon } from "@/components/ui";
import { colors, radius, spacing } from "@/theme";

/**
 * The note above the box on the screen writing a first message (`firstMessageNotice`), as on the web: a compact card with
 * the envelope in the brand's badge, which screen readers skip, and its words read before the box.
 */
export function FirstMessageNote({ notice }: { notice: FirstMessageNotice }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.md, width: "100%", maxWidth: 360, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg }}>
      <EmptyIcon icon={<IconMail />} size="small" />
      <View style={{ flex: 1, gap: spacing.xs }}>
        <Text style={{ fontSize: 15, lineHeight: 20, fontWeight: "600", color: colors.text }}>{notice.title}</Text>
        <Text style={{ fontSize: 14, lineHeight: 20, color: colors.secondary }}>{notice.text}</Text>
        <Text style={{ fontSize: 13, lineHeight: 18, color: colors.muted, marginTop: spacing.xs }}>{notice.tip}</Text>
      </View>
    </View>
  );
}

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
