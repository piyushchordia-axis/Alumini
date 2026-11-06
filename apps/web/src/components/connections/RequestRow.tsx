import { DELETED_MEMBER_NAME, memberRoleLine, memberYearsLabel, type MemberCardDto } from "@illuminize/shared";
import { useId, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Avatar, Badge } from "@/components/ui";

export type RequestTone = "warning" | "info" | "success" | "neutral";

/**
 * One request between two members (a mentorship, a referral), as one side of it sees it: who it's with, what it's about,
 * the note, where it stands and when, and whatever this member can do about it in `actions`. A member who has deleted their
 * account shows as such.
 */
export function RequestRow({
  id,
  member,
  profileHref,
  status,
  tone,
  when,
  about,
  noteLabel,
  note,
  actions,
}: {
  id?: string;
  member: MemberCardDto | null;
  profileHref: string | null;
  status: string;
  tone: RequestTone;
  when: string;
  /** What the request is about, under who it's with. */
  about?: ReactNode;
  noteLabel: string;
  note: string;
  actions?: ReactNode;
}) {
  const nameId = useId();
  const name = member?.fullName ?? DELETED_MEMBER_NAME;
  return (
    // A card named for who it's with, so a screen reader's list of them reads as a list of people. Focusable from script only,
    // so focus has somewhere to land when an action takes away the button that had it.
    <article id={id} tabIndex={-1} aria-labelledby={nameId} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
      <div className="flex items-start gap-3">
        <Avatar name={name} src={member?.avatarUrl} size="md" />
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
            <Badge tone={tone}>{status}</Badge>
          </div>
          {member && (
            <p className="text-sm text-slate-600 [overflow-wrap:anywhere]">
              {memberRoleLine(member)} · {memberYearsLabel(member)}
            </p>
          )}
          {about}
          <p className="mt-0.5 text-xs text-slate-500">{when}</p>
        </div>
      </div>
      <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2">
        <p className="text-xs font-medium text-slate-500">{noteLabel}</p>
        <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-800 [overflow-wrap:anywhere]">{note}</p>
      </div>
      {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
    </article>
  );
}
