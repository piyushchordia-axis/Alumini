import { CHAT_REPORT_ESCALATION_LABELS, CHAT_REPORT_TARGET_KIND_LABELS, DELETED_MEMBER_NAME, NEEDS_OTHER_STAFF_TEXT, REPORT_REASON_LABELS, REPORT_STATUSES, REPORT_STATUS_LABELS, type PlatformChatReportDto, type ReportStatus } from "@illuminize/shared";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { useState } from "react";
import { Link } from "react-router-dom";
import { IconCheck } from "@/components/icons";
import { Badge, EmptyState, ErrorBox, Loading, PageHeader, Pagination, Tabs } from "@/components/ui";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { qk } from "@/lib/queryKeys";

/**
 * Why this member of staff can't open the report, when they can't: an open one waits for another member of staff (or for
 * there to be one), while a closed one needs nobody, but its messages are still not theirs to read.
 */
function leftToOtherStaff(r: PlatformChatReportDto): string | null {
  if (!r.needsOtherStaff) return null;
  if (r.status !== "OPEN") return "You changed this institution's admins after this report was filed, so you can't open it.";
  return r.noStaffCanTake ? `${NEEDS_OTHER_STAFF_TEXT} No other member of staff can take it yet: make someone a platform admin under Users.` : NEEDS_OTHER_STAFF_TEXT;
}

export function PlatformChatReportsPage() {
  const [status, setStatus] = useState<ReportStatus>("OPEN");
  const [page, setPage] = useState(1);
  const query = { status, page, pageSize: 25 };
  const q = useQuery({ queryKey: qk.platform.chatReports(query), queryFn: () => api.platform.chatReports.list(query) });
  return (
    <div className="space-y-4">
      <PageHeader title="Chat reports" subtitle="Reports about an institution's admin, or with no other admin to handle them. Opening one is recorded in that institution's audit log." />
      <Tabs
        value={status}
        onChange={(v) => {
          setStatus(v);
          setPage(1);
        }}
        tabs={REPORT_STATUSES.map((s) => ({ value: s, label: REPORT_STATUS_LABELS[s] }))}
        className="w-fit max-w-full"
      />
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} />}
      {q.data && q.data.data.length === 0 && <EmptyState icon={<IconCheck size={32} className="text-slate-400" />} title={`No ${REPORT_STATUS_LABELS[status].toLowerCase()} escalated reports`} />}
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {q.data?.data.map((r) => (
          <ReportRow key={r.id} report={r} />
        ))}
      </ul>
      {q.data && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onChange={setPage} />}
    </div>
  );
}

function ReportRow({ report: r }: { report: PlatformChatReportDto }) {
  const note = leftToOtherStaff(r);
  return (
    <li className="px-4 py-3">
      {/* The link leads to where it's opened and closed, which isn't this staff member's to do. */}
      {note ? (
        <span className="font-medium text-slate-900">{r.tenant.name}</span>
      ) : (
        <Link to={`/t/${r.tenant.slug}/admin/chat-reports?status=${r.status}`} className="font-medium text-primary hover:underline">
          {r.tenant.name}
        </Link>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <Badge>{CHAT_REPORT_ESCALATION_LABELS[r.basis]}</Badge>
        <Badge tone="danger">{REPORT_REASON_LABELS[r.reason]}</Badge>
        <Badge tone="info">{CHAT_REPORT_TARGET_KIND_LABELS[r.targetKind]}</Badge>
        <span className="text-xs text-slate-500">
          {r.reporter?.fullName ?? DELETED_MEMBER_NAME} reported {r.reported?.fullName ?? DELETED_MEMBER_NAME} · {timeAgo(r.createdAt)}
        </span>
      </div>
      {note && <p className={clsx("mt-2 rounded-lg border px-3 py-2 text-sm", r.status === "OPEN" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-slate-200 bg-slate-50 text-slate-700")}>{note}</p>}
    </li>
  );
}
