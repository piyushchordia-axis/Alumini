import type { AuditDto } from "@illuminize/shared";
import { Badge } from "@/components/ui";
import { formatDateTime } from "@/lib/format";

export function AuditTable({ rows }: { rows: AuditDto[] }) {
  if (rows.length === 0) return <p className="py-8 text-center text-sm text-slate-400">No activity yet.</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
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
          {rows.map((a) => (
            <tr key={a.id}>
              <td className="whitespace-nowrap px-3 py-2 text-slate-500">{formatDateTime(a.createdAt)}</td>
              <td className="px-3 py-2">
                <Badge>{a.action}</Badge>
              </td>
              <td className="px-3 py-2">{a.actorName ?? (a.actorUserId ? "Platform / system" : "—")}</td>
              <td className="px-3 py-2 text-slate-500">{a.targetType ? `${a.targetType} ${a.targetId?.slice(0, 8) ?? ""}` : "—"}</td>
              <td className="max-w-md truncate px-3 py-2 font-mono text-xs text-slate-500">{Object.keys(a.metadata).length ? JSON.stringify(a.metadata) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
