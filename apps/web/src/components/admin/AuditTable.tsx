import { auditActorLabel, auditDetailLines, auditTargetLabel, type AuditDto } from "@illuminize/shared";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui";
import { formatDateTime } from "@/lib/format";

/** How many detail lines a stacked row shows, as on the phone app. */
const STACKED_LINES = 4;

/**
 * Audit rows: a table from `sm` up, and below it the same stacked rows as the phone app, so a phone never scrolls
 * sideways. `memberHref` links a row whose target is a membership to that member's admin page (not `selfId`, the page
 * already open); the platform console, with no institution, passes none.
 */
export function AuditTable({ rows, memberHref, selfId }: { rows: AuditDto[]; memberHref?: (membershipId: string) => string; selfId?: string }) {
  if (rows.length === 0) return <p className="py-8 text-center text-sm text-slate-400">No activity yet.</p>;
  const target = (a: AuditDto) => {
    const t = auditTargetLabel(a);
    return t.membershipId && memberHref && t.membershipId !== selfId ? (
      <Link to={memberHref(t.membershipId)} className="inline-flex min-h-11 items-center text-primary-ink underline-offset-2 hover:underline sm:min-h-0">
        {t.text}
      </Link>
    ) : (
      t.text
    );
  };
  return (
    <>
      <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white sm:block">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Actor</th>
              <th className="px-3 py-2">Target</th>
              <th className="px-3 py-2">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((a) => {
              const details = auditDetailLines(a.metadata).join("; ");
              return (
                <tr key={a.id}>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-500">{formatDateTime(a.createdAt)}</td>
                  <td className="px-3 py-2">
                    <Badge>{a.action}</Badge>
                  </td>
                  <td className="px-3 py-2">{auditActorLabel(a)}</td>
                  <td className="px-3 py-2 text-slate-500">{target(a)}</td>
                  <td className="max-w-md truncate px-3 py-2 text-xs text-slate-500" title={details || undefined}>
                    {details}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white sm:hidden">
        {rows.map((a) => (
          <li key={a.id} className="space-y-0.5 px-4 py-2.5">
            <div className="flex items-start justify-between gap-2">
              <Badge className="min-w-0 break-all">{a.action}</Badge>
              <span className="shrink-0 text-xs text-slate-500">{formatDateTime(a.createdAt)}</span>
            </div>
            <p className="text-sm text-slate-800">{auditActorLabel(a)}</p>
            <p className="text-sm text-slate-500">{target(a)}</p>
            {auditDetailLines(a.metadata)
              .slice(0, STACKED_LINES)
              .map((line, i) => (
                <p key={i} className="line-clamp-2 break-words text-xs text-slate-500">
                  {line}
                </p>
              ))}
          </li>
        ))}
      </ul>
    </>
  );
}
