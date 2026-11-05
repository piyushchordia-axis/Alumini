import { MODERATION_STATUS_LABELS, MODERATION_STATUS_TONE, type ModerationStatus } from "@illuminize/shared";
import { Text, View } from "react-native";
import { Badge } from "@/components/ui";

export function ModerationBadge({ status }: { status: ModerationStatus }) {
  if (status === "APPROVED") return null;
  return <Badge label={MODERATION_STATUS_LABELS[status]} tone={MODERATION_STATUS_TONE[status]} />;
}

/** The admin's note on rejected or removed content (only the author and admins receive it). */
export function ModerationNote({ status, note }: { status: ModerationStatus; note?: string | null }) {
  if (!note || (status !== "REJECTED" && status !== "REMOVED")) return null;
  return (
    <View style={{ backgroundColor: "#fef2f2", borderRadius: 8, padding: 8 }} accessibilityRole="text">
      <Text style={{ color: "#991b1b", fontSize: 12 }}>Admin note: {note}</Text>
    </View>
  );
}
