import { MEMBERSHIP_STATUS_LABELS, MEMBER_STATUS_TONE, type MembershipStatus } from "@illuminize/shared";
import { Badge } from "@/components/ui";

export function MemberStatusBadge({ status }: { status: MembershipStatus }) {
  return <Badge tone={MEMBER_STATUS_TONE[status]}>{MEMBERSHIP_STATUS_LABELS[status]}</Badge>;
}
