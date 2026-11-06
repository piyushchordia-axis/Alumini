import {
  ADMIN_REASON_PROMPTS,
  CONTENT_TYPE_LABELS,
  REPORTS_SUBTITLE,
  REPORT_CONTENT_GONE_TEXT,
  REPORT_REASON_LABELS,
  REPORT_STATUSES,
  REPORT_STATUS_LABELS,
  parseReportStatus,
  queueTabCounts,
  reportEmptyTitle,
  reportShowsTitle,
  reportedByText,
  statusTabs,
  type AdminReportDto,
  type ReasonPromptKey,
} from "@illuminize/shared";
import { errorMessage, isOutOfDate, unlessOutOfDate } from "@illuminize/shared/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ReasonModal } from "@/components/admin/ReasonModal";
import { IconCheck } from "@/components/icons";
import { ModerationStatusBadge } from "@/components/moderation/ModerationStatusBadge";
import { Badge, Button, EmptyState, ErrorBox, Loading, PageHeader, Pagination, Tabs } from "@/components/ui";
import { useAdminTenant } from "@/hooks/useAdminTenant";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { invalidateTenant } from "@/lib/invalidate";
import { qk } from "@/lib/queryKeys";
import { toast } from "@/stores/uiStore";

type ReportPrompt = Extract<ReasonPromptKey, "reportRemove" | "reportResolve" | "reportDismiss">;

function ReportRow({ slug, report }: { slug: string; report: AdminReportDto }) {
  const qc = useQueryClient();
  const [modal, setModal] = useState<ReportPrompt | null>(null);
  const refresh = () => void invalidateTenant(qc, slug);
  const done = (msg: string) => () => {
    refresh();
    toast.success(msg);
  };
  const failed = (e: unknown) => {
    toast.error(errorMessage(e));
    // Already handled by another admin, or gone: what the list shows is out of date.
    if (isOutOfDate(e)) refresh();
  };
  const resolve = useMutation({
    mutationFn: (v: { action: "REMOVE_CONTENT" | "NONE"; note?: string }) => api.admin.reports.resolve(slug, report.id, { action: v.action, note: v.note || null }),
    onSuccess: done("Report resolved"),
    onError: failed,
  });
  const dismiss = useMutation({ mutationFn: (note?: string) => api.admin.reports.dismiss(slug, report.id, note || null), onSuccess: done("Report dismissed"), onError: failed });
  const send = (key: ReportPrompt, note: string) => (key === "reportDismiss" ? dismiss.mutateAsync(note) : resolve.mutateAsync({ action: key === "reportRemove" ? "REMOVE_CONTENT" : "NONE", note }));
  const ask = (key: ReportPrompt) => {
    const prompt = ADMIN_REASON_PROMPTS[key];
    // An out-of-date answer closes the modal, as trying again can't help; the toast says why.
    return <ReasonModal open={modal === key} title={prompt.title} label={prompt.body} tone={prompt.tone} confirmLabel={prompt.confirm} onClose={() => setModal(null)} onConfirm={(note) => unlessOutOfDate(() => send(key, note))} />;
  };
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="danger">{REPORT_REASON_LABELS[report.reason]}</Badge>
            <Badge tone="info">{CONTENT_TYPE_LABELS[report.contentType]}</Badge>
            {report.content && <ModerationStatusBadge status={report.content.moderationStatus} showApproved />}
            <span className="text-xs text-slate-500">{reportedByText(report, timeAgo(report.createdAt))}</span>
          </div>
          {report.details && <p className="mt-1 text-sm text-slate-700">“{report.details}”</p>}
          <div className="mt-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-800">
            {report.content ? (
              <>
                {reportShowsTitle(report.content) && <p className="font-medium">{report.content.title}</p>}
                {report.content.excerpt ?? report.content.title}
              </>
            ) : (
              <em className="text-slate-400">{REPORT_CONTENT_GONE_TEXT}</em>
            )}
          </div>
          {report.resolutionNote && <p className="mt-1 text-xs text-slate-500">Resolution: {report.resolutionNote}</p>}
        </div>
        {report.status === "OPEN" && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="danger" onClick={() => setModal("reportRemove")}>
              Remove content
            </Button>
            <Button size="sm" variant="outline" onClick={() => setModal("reportResolve")}>
              Resolve, keep content
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setModal("reportDismiss")}>
              Dismiss
            </Button>
          </div>
        )}
      </div>
      {report.status === "OPEN" && (
        <>
          {ask("reportRemove")}
          {ask("reportResolve")}
          {ask("reportDismiss")}
        </>
      )}
    </li>
  );
}

export function AdminReportsPage() {
  const { tenant } = useAdminTenant();
  const slug = tenant.slug;
  const [params, setParams] = useSearchParams();
  const status = parseReportStatus(params.get("status"));
  const page = Number(params.get("page") ?? "1");
  const query = { status, page, pageSize: 20 };
  const list = useQuery({ queryKey: qk.admin.reports(slug, query), queryFn: () => api.admin.reports.list(slug, query) });
  const dashboard = useQuery({ queryKey: qk.admin.dashboard(slug), queryFn: () => api.admin.dashboard(slug) });
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== "page") next.delete("page");
    setParams(next);
  };
  return (
    <div className="space-y-4">
      <PageHeader title="Reports" subtitle={REPORTS_SUBTITLE} />
      <Tabs value={status} onChange={(v) => setParam("status", v)} tabs={statusTabs(REPORT_STATUSES, REPORT_STATUS_LABELS, queueTabCounts(dashboard.data)?.reports)} className="w-fit" />
      {list.isLoading && <Loading />}
      {list.error && <ErrorBox error={list.error} />}
      {list.data && list.data.data.length === 0 && <EmptyState icon={<IconCheck size={32} className="text-slate-400" />} title={reportEmptyTitle(status)} />}
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {list.data?.data.map((r) => (
          <ReportRow key={r.id} slug={slug} report={r} />
        ))}
      </ul>
      {list.data && <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onChange={(p) => setParam("page", String(p))} />}
    </div>
  );
}
