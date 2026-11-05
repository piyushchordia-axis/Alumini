import { MODERATION_STATUS_LABELS, MODERATION_STATUS_TONE, type ModerationStatus } from "@illuminize/shared";
import { Badge } from "@/components/ui";

export function ModerationStatusBadge({ status, note, showApproved = false }: { status: ModerationStatus; note?: string | null; showApproved?: boolean }) {
  if (status === "APPROVED" && !showApproved) return null;
  return (
    <span className="inline-flex items-center gap-2">
      <Badge tone={MODERATION_STATUS_TONE[status]}>{MODERATION_STATUS_LABELS[status]}</Badge>
      {note && status !== "APPROVED" && <span className="text-xs text-slate-500">“{note}”</span>}
    </span>
  );
}

/** The admin's note as its own line, for list cards where the badge sits in a narrow column. Only the author and admins receive it. */
export function ModerationCardNote({ status, note }: { status: ModerationStatus; note?: string | null }) {
  if (!note || status === "APPROVED") return null;
  return <p className="mt-2 text-xs text-slate-500">Admin note: {note}</p>;
}
