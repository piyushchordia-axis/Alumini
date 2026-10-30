import { CONTENT_TYPE_LABELS, REPORT_REASON_LABELS, REPORT_STATUSES, type AdminReportDto, type ReportStatus } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ReasonModal } from "@/components/admin/ReasonModal";
import { Badge, Button, EmptyState, ErrorBox, Loading, PageHeader, Pagination, Tabs } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { qk } from "@/lib/queryKeys";
import { toast } from "@/stores/uiStore";

function ReportRow({ slug, report }: { slug: string; report: AdminReportDto }) {
  const qc = useQueryClient();
  const [modal, setModal] = useState<"remove" | "dismiss" | "none" | null>(null);
  const refresh = (msg: string) => () => {
    void qc.invalidateQueries({ queryKey: ["admin", slug] });
    toast.success(msg);
  };
  const resolve = useMutation({
    mutationFn: (v: { action: "REMOVE_CONTENT" | "NONE"; note?: string }) => api.admin.reports.resolve(slug, report.id, { action: v.action, note: v.note || null }),
    onSuccess: refresh("Report resolved"),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const dismiss = useMutation({ mutationFn: (note?: string) => api.admin.reports.dismiss(slug, report.id, note || null), onSuccess: refresh("Report dismissed"), onError: (e) => toast.error(errorMessage(e)) });
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="danger">{REPORT_REASON_LABELS[report.reason]}</Badge>
            <Badge tone="info">{CONTENT_TYPE_LABELS[report.contentType]}</Badge>
            {report.content && <Badge>{report.content.moderationStatus}</Badge>}
            <span className="text-xs text-slate-500">
              reported by {report.reporter.fullName} · {timeAgo(report.createdAt)}
            </span>
          </div>
          {report.details && <p className="mt-1 text-sm text-slate-700">“{report.details}”</p>}
          <div className="mt-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-800">{report.content ? (report.content.excerpt ?? report.content.title) : <em className="text-slate-400">Content no longer exists</em>}</div>
          {report.resolutionNote && <p className="mt-1 text-xs text-slate-500">Resolution: {report.resolutionNote}</p>}
        </div>
        {report.status === "OPEN" && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="danger" onClick={() => setModal("remove")}>
              Remove content
            </Button>
            <Button size="sm" variant="outline" onClick={() => setModal("none")}>
              Resolve, keep content
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setModal("dismiss")}>
              Dismiss
            </Button>
          </div>
        )}
      </div>
      <ReasonModal open={modal === "remove"} title="Remove the reported content?" label="The author is notified; all open reports on it are resolved." tone="danger" confirmLabel="Remove" onClose={() => setModal(null)} onConfirm={(note) => resolve.mutateAsync({ action: "REMOVE_CONTENT", note })} />
      <ReasonModal open={modal === "none"} title="Resolve without removing" label="Add a note for the audit trail." confirmLabel="Resolve" onClose={() => setModal(null)} onConfirm={(note) => resolve.mutateAsync({ action: "NONE", note })} />
      <ReasonModal open={modal === "dismiss"} title="Dismiss this report" confirmLabel="Dismiss" onClose={() => setModal(null)} onConfirm={(note) => dismiss.mutateAsync(note)} />
    </li>
  );
}

export function AdminReportsPage() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const [params, setParams] = useSearchParams();
  const status = (params.get("status") as ReportStatus) || "OPEN";
  const page = Number(params.get("page") ?? "1");
  const query = { status, page, pageSize: 20 };
  const list = useQuery({ queryKey: qk.admin.reports(slug, query), queryFn: () => api.admin.reports.list(slug, query) });
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== "page") next.delete("page");
    setParams(next);
  };
  return (
    <div className="space-y-4">
      <PageHeader title="Reports" subtitle="Content flagged by members" />
      <Tabs value={status} onChange={(v) => setParam("status", v)} tabs={REPORT_STATUSES.map((s) => ({ value: s, label: s.charAt(0) + s.slice(1).toLowerCase() }))} className="w-fit" />
      {list.isLoading && <Loading />}
      {list.error && <ErrorBox error={list.error} />}
      {list.data && list.data.data.length === 0 && <EmptyState icon="🎉" title={`No ${status.toLowerCase()} reports`} />}
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {list.data?.data.map((r) => (
          <ReportRow key={r.id} slug={slug} report={r} />
        ))}
      </ul>
      {list.data && <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onChange={(p) => setParam("page", String(p))} />}
    </div>
  );
}
