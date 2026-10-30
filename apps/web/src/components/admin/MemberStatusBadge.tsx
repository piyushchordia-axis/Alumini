import { MEMBERSHIP_STATUS_LABELS, type MembershipStatus } from "@illuminize/shared";
import { Badge } from "@/components/ui";

const tone = { PENDING: "warning", APPROVED: "success", REJECTED: "danger", SUSPENDED: "neutral" } as const;

export function MemberStatusBadge({ status }: { status: MembershipStatus }) {
  return <Badge tone={tone[status]}>{MEMBERSHIP_STATUS_LABELS[status]}</Badge>;
}
