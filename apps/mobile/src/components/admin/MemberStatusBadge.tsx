import { MEMBERSHIP_STATUS_LABELS, MEMBER_STATUS_TONE, type MembershipStatus } from "@illuminize/shared";
import { Badge } from "@/components/ui";

export function MemberStatusBadge({ status }: { status: MembershipStatus }) {
  return <Badge label={MEMBERSHIP_STATUS_LABELS[status]} tone={MEMBER_STATUS_TONE[status]} />;
}
