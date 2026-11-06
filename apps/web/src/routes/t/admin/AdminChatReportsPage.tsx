import {
  CHAT_REPORTS_SUBTITLE,
  CHAT_REPORT_MESSAGE_GONE_TEXT,
  CHAT_REPORT_TARGET_KIND_LABELS,
  CHAT_REPORT_VIEW_HINT,
  REPORT_REASON_LABELS,
  chatReportActionLabel,
  chatReportActionsFor,
  chatReportCloseRequest,
  chatReportDoneText,
  chatReportEmptyTitle,
  chatReportHeadline,
  chatReportMemberLinkText,
  chatReportPrompt,
  chatReportSenderLabel,
  chatReportTabs,
  chatReportViewLabel,
  parseChatReportStatus,
  type AdminChatReportDto,
  type AdminChatReportMessageDto,
  type AdminChatReportViewDto,
  type ChatReportCloseAction,
} from "@illuminize/shared";
import { errorMessage, isOutOfDate, unlessOutOfDate } from "@illuminize/shared/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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

const CLOSE_ACTIONS: readonly ChatReportCloseAction[] = ["remove", "resolve", "dismiss"];
const VARIANT: Readonly<Record<ChatReportCloseAction, "danger" | "outline" | "ghost">> = { remove: "danger", resolve: "outline", dismiss: "ghost" };

/** Each message as it reads in the thread, oldest first, with the reported one marked. */
function ReportedMessages({ messages }: { messages: AdminChatReportMessageDto[] }) {
  if (messages.length === 0) return <p className="text-sm text-slate-500">{CHAT_REPORT_MESSAGE_GONE_TEXT}</p>;
  return (
    <ol className="space-y-2">
      {messages.map((m) => (
        <li key={m.id} className={clsx("rounded-lg border p-3 text-sm", m.isTarget ? "border-red-300 bg-red-50" : "border-slate-200 bg-white")}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-900">{chatReportSenderLabel(m)}</span>
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
  const [modal, setModal] = useState<ChatReportCloseAction | null>(null);
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
      setModal(null);
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
    setModal(null);
  };
  // Called straight, not through useMutation: the admin's note may quote the message, and a mutation keeps what it sent
  // in its cache. The dialog shows the call as busy, and stays open with the note if it fails.
  const closeReport = async (action: ChatReportCloseAction, note: string) => {
    const request = chatReportCloseRequest(action, note);
    try {
      await (request.call === "resolve" ? api.admin.chatReports.resolve(slug, report.id, request.input) : api.admin.chatReports.dismiss(slug, report.id, request.note));
    } catch (e) {
      failed(e);
      throw e;
    }
    setView(null);
    setModal(null);
    void invalidateTenant(qc, slug);
    toast.success(chatReportDoneText(action));
  };
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="danger">{REPORT_REASON_LABELS[report.reason]}</Badge>
        <Badge tone="info">{CHAT_REPORT_TARGET_KIND_LABELS[report.targetKind]}</Badge>
        {report.resolutionAction === "REMOVE_MESSAGE" && <Badge>Message removed</Badge>}
        <span className="text-xs text-slate-500">
          {chatReportHeadline(report)} · {timeAgo(report.createdAt)}
        </span>
      </div>
      {view ? (
        <div className="mt-3 space-y-3">
          {view.details && (
            <p className="break-words text-sm text-slate-700">
              <span className="font-medium">Reporter's note:</span> {view.details}
            </p>
          )}
          {report.targetKind === "MESSAGE" ? <ReportedMessages messages={view.messages} /> : <p className="whitespace-pre-wrap break-words rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-slate-800">{view.noteSnapshot}</p>}
          {view.resolutionNote && <p className="break-words text-xs text-slate-500">Resolution: {view.resolutionNote}</p>}
          {report.reported && (
            <p className="text-xs text-slate-500">
              To suspend them, open{" "}
              <Link to={`/t/${slug}/admin/members/${report.reported.id}`} className="text-primary underline">
                {chatReportMemberLinkText(report.reported)}
              </Link>
              .
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {chatReportActionsFor(report).map((action) => (
              <Button key={action} size="sm" variant={VARIANT[action]} onClick={() => setModal(action)}>
                {chatReportActionLabel(action, report.targetKind)}
              </Button>
            ))}
            <Button size="sm" variant="ghost" onClick={close}>
              Hide
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void open()} loading={opening}>
            {chatReportViewLabel(report.targetKind)}
          </Button>
          <span className="text-xs text-slate-500">{CHAT_REPORT_VIEW_HINT}</span>
        </div>
      )}
      {/* Only while the messages are open, so a note typed and cancelled (it may quote the message) goes with them on
          Hide, an out-of-date answer or leaving, as on the phone, rather than waiting pre-filled for the next view. */}
      {view &&
        CLOSE_ACTIONS.map((action) => {
          const prompt = chatReportPrompt(action, report.targetKind);
          return <ReasonModal key={action} open={modal === action} title={prompt.title} label={prompt.body} tone={prompt.tone} confirmLabel={prompt.confirm} onClose={() => setModal(null)} onConfirm={(note) => unlessOutOfDate(() => closeReport(action, note))} />;
        })}
    </li>
  );
}

export function AdminChatReportsPage() {
  const { tenant } = useAdminTenant();
  const slug = tenant.slug;
  const [params, setParams] = useSearchParams();
  const status = parseChatReportStatus(params.get("status"));
  const page = Number(params.get("page") ?? "1");
  const query = { status, page, pageSize: 20 };
  const list = useQuery({ queryKey: qk.admin.chatReports(slug, query), queryFn: () => api.admin.chatReports.list(slug, query) });
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
      <PageHeader title="Chat reports" subtitle={CHAT_REPORTS_SUBTITLE} />
      <Tabs value={status} onChange={(v) => setParam("status", v)} tabs={chatReportTabs(dashboard.data)} className="w-fit max-w-full" />
      {list.isLoading && <Loading />}
      {list.error && <ErrorBox error={list.error} />}
      {list.data && list.data.data.length === 0 && <EmptyState icon={<IconCheck size={32} className="text-slate-400" />} title={chatReportEmptyTitle(status)} />}
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {list.data?.data.map((r) => (
          <ChatReportRow key={r.id} slug={slug} report={r} />
        ))}
      </ul>
      {list.data && <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onChange={(p) => setParam("page", String(p))} />}
    </div>
  );
}
