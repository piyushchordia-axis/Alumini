import { MODERATION_STATUS_LABELS, type ModerationStatus } from "@illuminize/shared";
import { Text, View } from "react-native";
import { Badge } from "@/components/ui";

const tone = { PENDING: "warning", APPROVED: "success", REJECTED: "danger", REMOVED: "neutral" } as const;

export function ModerationBadge({ status }: { status: ModerationStatus }) {
  if (status === "APPROVED") return null;
  return <Badge label={MODERATION_STATUS_LABELS[status]} tone={tone[status]} />;
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
