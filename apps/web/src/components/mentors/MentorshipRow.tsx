import { DELETED_MEMBER_NAME, memberRoleLine, mentorshipStatusLabel, mentorshipWhen, type MentorshipDto } from "@illuminize/shared";
import { useId, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Avatar, Badge } from "@/components/ui";
import { formatDate } from "@/lib/format";

const TONE = { REQUESTED: "warning", ACCEPTED: "success", DECLINED: "neutral", ENDED: "neutral" } as const;

/**
 * One request or mentorship, as one side of it sees it: who it's with, the note, where it stands and when, and whatever
 * this member can do about it in `actions`. A member who has deleted their account shows as such.
 */
export function MentorshipRow({ id, m, profileHref, actions }: { id?: string; m: MentorshipDto; profileHref: string | null; actions?: ReactNode }) {
  const nameId = useId();
  const name = m.member?.fullName ?? DELETED_MEMBER_NAME;
  // A request waiting for this member's answer stands out; one they're waiting on reads as information.
  const tone = m.status === "REQUESTED" && m.box === "sent" ? "info" : TONE[m.status];
  return (
    // A card named for who it's with, so a screen reader's list of them reads as a list of people. Focusable from script only,
    // so focus has somewhere to land when an action takes away the button that had it.
    <article id={id} tabIndex={-1} aria-labelledby={nameId} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
      <div className="flex items-start gap-3">
        <Avatar name={name} src={m.member?.avatarUrl} size="md" />
        <div className="min-w-0 flex-1">
          {/* The status follows the name, and wraps under it on a phone rather than squeezing it. */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 id={nameId} className="min-w-0 font-semibold text-slate-900 [overflow-wrap:anywhere]">
              {profileHref ? (
                <Link to={profileHref} className="hover:underline focus-visible:outline-2 focus-visible:outline-primary">
                  {name}
                </Link>
              ) : (
                name
              )}
            </h3>
            <Badge tone={tone}>{mentorshipStatusLabel(m)}</Badge>
          </div>
          {m.member && (
            <p className="text-sm text-slate-600 [overflow-wrap:anywhere]">
              {memberRoleLine(m.member)} · Batch of {m.member.batchYear}
            </p>
          )}
          <p className="mt-0.5 text-xs text-slate-500">{mentorshipWhen(m, (iso) => formatDate(iso))}</p>
        </div>
      </div>
      <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2">
        <p className="text-xs font-medium text-slate-500">{m.box === "received" ? "Their note" : "Your note"}</p>
        <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-800 [overflow-wrap:anywhere]">{m.note}</p>
      </div>
      {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
    </article>
  );
}
