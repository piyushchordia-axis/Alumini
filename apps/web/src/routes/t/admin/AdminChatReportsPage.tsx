import { CHAT_REPORT_TARGET_KIND_LABELS, DELETED_MEMBER_NAME, REPORT_REASON_LABELS, REPORT_STATUSES, REPORT_STATUS_LABELS, type AdminChatReportDto, type AdminChatReportMessageDto, type AdminChatReportViewDto, type ReportStatus } from "@illuminize/shared";
import { errorMessage, isOutOfDate, unlessOutOfDate } from "@illuminize/shared/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ReasonModal } from "@/components/admin/ReasonModal";
import { IconCheck } from "@/components/icons";
import { Badge, Button, EmptyState, ErrorBox, Loading, PageHeader, Pagination, Tabs } from "@/components/ui";
import { useAdminTenant } from "@/hooks/useAdminTenant";
import { api } from "@/lib/api";
import { formatDateTime, timeAgo } from "@/lib/format";
import { invalidateTenant } from "@/lib/invalidate";
import { qk } from "@/lib/queryKeys";
import { toast } from "@/stores/uiStore";

const nameOf = (member: AdminChatReportDto["reporter"]) => member?.fullName ?? DELETED_MEMBER_NAME;

function senderLabel(m: AdminChatReportMessageDto): string {
  return m.kind === "SYSTEM" ? "System message" : nameOf(m.sender);
}

/** Each message as it reads in the thread, oldest first, with the reported one marked. */
function ReportedMessages({ messages }: { messages: AdminChatReportMessageDto[] }) {
  if (messages.length === 0) return <p className="text-sm text-slate-500">This message no longer exists.</p>;
  return (
    <ol className="space-y-2">
      {messages.map((m) => (
        <li key={m.id} className={clsx("rounded-lg border p-3 text-sm", m.isTarget ? "border-red-300 bg-red-50" : "border-slate-200 bg-white")}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-900">{senderLabel(m)}</span>
            <span className="text-xs text-slate-500">{formatDateTime(m.createdAt)}</span>
            {m.isTarget && <Badge tone="danger">Reported message</Badge>}
            {m.removed && <Badge>Removed</Badge>}
          </div>
          <p className="mt-1 whitespace-pre-wrap break-words text-slate-800">{m.body}</p>
        </li>
      ))}
    </ol>
  );
}

function ChatReportRow({ slug, report }: { slug: string; report: AdminChatReportDto }) {
  const qc = useQueryClient();
  // Kept here and nowhere else. A query would refetch, and a useMutation would keep the text in the mutation cache, and every fetch writes an audit row.
  const [view, setView] = useState<AdminChatReportViewDto | null>(null);
  const [opening, setOpening] = useState(false);
  const [modal, setModal] = useState<"remove" | "none" | "dismiss" | null>(null);
  // A response that lands after the row closed or went away must not bring the text back.
  const latest = useRef(0);
  useEffect(
    () => () => {
      latest.current += 1;
    },
    [],
  );
  const failed = (e: unknown) => {
    toast.error(errorMessage(e));
    if (isOutOfDate(e)) {
      setView(null);
      void invalidateTenant(qc, slug);
    }
  };
  const open = async () => {
    const mine = ++latest.current;
    setOpening(true);
    try {
      const result = await api.admin.chatReports.view(slug, report.id);
      if (latest.current === mine) setView(result);
    } catch (e) {
      if (latest.current === mine) failed(e);
    } finally {
      if (latest.current === mine) setOpening(false);
    }
  };
  const close = () => {
    latest.current += 1;
    setOpening(false);
    setView(null);
  };
  const refresh = (msg: string) => () => {
    setView(null);
    void invalidateTenant(qc, slug);
    toast.success(msg);
  };
  const resolve = useMutation({
    mutationFn: (v: { action: "REMOVE_MESSAGE" | "NONE"; note?: string }) => api.admin.chatReports.resolve(slug, report.id, { action: v.action, note: v.note || null }),
    onSuccess: refresh("Report resolved"),
    onError: failed,
  });
  const dismiss = useMutation({ mutationFn: (note?: string) => api.admin.chatReports.dismiss(slug, report.id, note || null), onSuccess: refresh("Report dismissed"), onError: failed });
  const isMessage = report.targetKind === "MESSAGE";
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="danger">{REPORT_REASON_LABELS[report.reason]}</Badge>
        <Badge tone="info">{CHAT_REPORT_TARGET_KIND_LABELS[report.targetKind]}</Badge>
        {report.resolutionAction === "REMOVE_MESSAGE" && <Badge>Message removed</Badge>}
        <span className="text-xs text-slate-500">
          {nameOf(report.reporter)} reported {nameOf(report.reported)} · {timeAgo(report.createdAt)}
        </span>
      </div>
      {view ? (
        <div className="mt-3 space-y-3">
          {view.details && (
            <p className="break-words text-sm text-slate-700">
              <span className="font-medium">Reporter's note:</span> {view.details}
            </p>
          )}
          {isMessage ? <ReportedMessages messages={view.messages} /> : <p className="whitespace-pre-wrap break-words rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-slate-800">{view.noteSnapshot}</p>}
          {view.resolutionNote && <p className="break-words text-xs text-slate-500">Resolution: {view.resolutionNote}</p>}
          {report.reported && (
            <p className="text-xs text-slate-500">
              To suspend them, open{" "}
              <Link to={`/t/${slug}/admin/members/${report.reported.id}`} className="text-primary underline">
                {report.reported.fullName}'s member page
              </Link>
              .
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {report.status === "OPEN" && (
              <>
                {isMessage && (
                  <Button size="sm" variant="danger" onClick={() => setModal("remove")}>
                    Remove message
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => setModal("none")}>
                  {isMessage ? "Resolve, keep message" : "Resolve"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setModal("dismiss")}>
                  Dismiss
                </Button>
              </>
            )}
            <Button size="sm" variant="ghost" onClick={close}>
              Hide
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void open()} loading={opening}>
            {isMessage ? "View messages" : "View request"}
          </Button>
          <span className="text-xs text-slate-500">Each view is recorded in the audit log.</span>
        </div>
      )}
      <ReasonModal open={modal === "remove"} title="Remove this message?" label="Everyone in the thread sees that it was removed. The sender is notified and sees your note in the app. All open reports on it are resolved." tone="danger" confirmLabel="Remove" onClose={() => setModal(null)} onConfirm={(note) => unlessOutOfDate(() => resolve.mutateAsync({ action: "REMOVE_MESSAGE", note }))} />
      <ReasonModal open={modal === "none"} title={isMessage ? "Resolve without removing" : "Resolve this report"} label="Add a note for the record." confirmLabel="Resolve" onClose={() => setModal(null)} onConfirm={(note) => unlessOutOfDate(() => resolve.mutateAsync({ action: "NONE", note }))} />
      <ReasonModal open={modal === "dismiss"} title="Dismiss this report" confirmLabel="Dismiss" onClose={() => setModal(null)} onConfirm={(note) => unlessOutOfDate(() => dismiss.mutateAsync(note))} />
    </li>
  );
}

export function AdminChatReportsPage() {
  const { tenant } = useAdminTenant();
  const slug = tenant.slug;
  const [params, setParams] = useSearchParams();
  const status = (params.get("status") as ReportStatus) || "OPEN";
  const page = Number(params.get("page") ?? "1");
  const query = { status, page, pageSize: 20 };
  const list = useQuery({ queryKey: qk.admin.chatReports(slug, query), queryFn: () => api.admin.chatReports.list(slug, query) });
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== "page") next.delete("page");
    setParams(next);
  };
  return (
    <div className="space-y-4">
      <PageHeader title="Chat reports" subtitle="Private messages members reported. You see a message only if you choose to, and never a whole conversation." />
      <Tabs value={status} onChange={(v) => setParam("status", v)} tabs={REPORT_STATUSES.map((s) => ({ value: s, label: REPORT_STATUS_LABELS[s] }))} className="w-fit max-w-full" />
      {list.isLoading && <Loading />}
      {list.error && <ErrorBox error={list.error} />}
      {list.data && list.data.data.length === 0 && <EmptyState icon={<IconCheck size={32} className="text-slate-400" />} title={`No ${status.toLowerCase()} chat reports`} />}
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {list.data?.data.map((r) => (
          <ChatReportRow key={r.id} slug={slug} report={r} />
        ))}
      </ul>
      {list.data && <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onChange={(p) => setParam("page", String(p))} />}
    </div>
  );
}
