import { CHAT_REPORT_TARGET_KIND_LABELS, DELETED_MEMBER_NAME, REPORT_REASON_LABELS, REPORT_STATUSES, type ReportStatus } from "@illuminize/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { IconCheck } from "@/components/icons";
import { Badge, EmptyState, ErrorBox, Loading, PageHeader, Pagination, Tabs } from "@/components/ui";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { qk } from "@/lib/queryKeys";

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
        tabs={REPORT_STATUSES.map((s) => ({ value: s, label: s.charAt(0) + s.slice(1).toLowerCase() }))}
        className="w-fit max-w-full"
      />
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} />}
      {q.data && q.data.data.length === 0 && <EmptyState icon={<IconCheck size={32} className="text-slate-400" />} title={`No ${status.toLowerCase()} escalated reports`} />}
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {q.data?.data.map((r) => (
          <li key={r.id} className="px-4 py-3">
            <Link to={`/t/${r.tenant.slug}/admin/chat-reports?status=${status}`} className="font-medium text-primary hover:underline">
              {r.tenant.name}
            </Link>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Badge tone="danger">{REPORT_REASON_LABELS[r.reason]}</Badge>
              <Badge tone="info">{CHAT_REPORT_TARGET_KIND_LABELS[r.targetKind]}</Badge>
              <span className="text-xs text-slate-500">
                {r.reporter?.fullName ?? DELETED_MEMBER_NAME} reported {r.reported?.fullName ?? DELETED_MEMBER_NAME} · {timeAgo(r.createdAt)}
              </span>
            </div>
          </li>
        ))}
      </ul>
      {q.data && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onChange={setPage} />}
    </div>
  );
}
