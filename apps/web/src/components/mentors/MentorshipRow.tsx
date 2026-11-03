import { mentorshipStatusLabel, mentorshipWhen, type MentorshipDto } from "@illuminize/shared";
import type { ReactNode } from "react";
import { RequestRow } from "@/components/connections/RequestRow";
import { formatDate } from "@/lib/format";

const TONE = { REQUESTED: "warning", ACCEPTED: "success", DECLINED: "neutral", ENDED: "neutral" } as const;

/** One request or mentorship, as one side of it sees it, with whatever this member can do about it in `actions`. */
export function MentorshipRow({ id, m, profileHref, actions }: { id?: string; m: MentorshipDto; profileHref: string | null; actions?: ReactNode }) {
  return (
    <RequestRow
      id={id}
      member={m.member}
      profileHref={profileHref}
      status={mentorshipStatusLabel(m)}
      // A request waiting for this member's answer stands out; one they're waiting on reads as information.
      tone={m.status === "REQUESTED" && m.box === "sent" ? "info" : TONE[m.status]}
      when={mentorshipWhen(m, (iso) => formatDate(iso))}
      noteLabel={m.box === "received" ? "Their note" : "Your note"}
      note={m.note}
      actions={actions}
    />
  );
}
