import { MODERATION_STATUS_LABELS, type ModerationStatus } from "@illuminize/shared";
import { Badge } from "@/components/ui";

const tone = { PENDING: "warning", APPROVED: "success", REJECTED: "danger", REMOVED: "neutral" } as const;

export function ModerationBadge({ status }: { status: ModerationStatus }) {
  if (status === "APPROVED") return null;
  return <Badge label={MODERATION_STATUS_LABELS[status]} tone={tone[status]} />;
}
