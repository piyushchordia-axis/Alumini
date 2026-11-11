import {
  CHAT_REPORTS_SUBTITLE,
  CHAT_REPORT_FILES_LOST_TEXT,
  CHAT_REPORT_FILES_TEXT,
  CHAT_REPORT_MESSAGE_GONE_TEXT,
  CHAT_REPORT_TARGET_KIND_LABELS,
  CHAT_REPORT_VIEW_HINT,
  REPORT_REASON_LABELS,
  chatReportActionLabel,
  chatReportActionsFor,
  chatReportCloseRequest,
  chatReportDoneText,
  chatReportEmptyText,
  chatReportEmptyTitle,
  chatReportFilesOpen,
  chatReportHasFiles,
  chatReportHeadline,
  chatReportMemberLinkText,
  chatReportPrompt,
  chatReportSenderLabel,
  chatReportTabs,
  chatReportViewLabel,
  parseChatReportStatus,
  type AdminChatAttachmentDto,
  type AdminChatReportDto,
  type AdminChatReportMessageDto,
  type AdminChatReportViewDto,
  type ChatReportCloseAction,
} from "@illuminize/shared";
import { errorMessage, isOutOfDate, unlessOutOfDate } from "@illuminize/shared/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useEffect, useId, useRef, useState, type Ref } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ReasonModal } from "@/components/admin/ReasonModal";
import { AttachmentGrid } from "@/components/chat/AttachmentGrid";
import { PhotoViewerFrame } from "@/components/chat/PhotoViewer";
import { IconCheck } from "@/components/icons";
import { Badge, Button, EmptyState, ErrorBox, ListSkeleton, Notice, PageHeader, Pagination, Tabs } from "@/components/ui";
import { useAdminTenant } from "@/hooks/useAdminTenant";
import { api } from "@/lib/api";
import { downloadFromUrl } from "@/lib/download";
import { formatDateTime, timeAgo } from "@/lib/format";
import { invalidateTenant } from "@/lib/invalidate";
import { qk } from "@/lib/queryKeys";
import { toast } from "@/stores/uiStore";

const CLOSE_ACTIONS: readonly ChatReportCloseAction[] = ["remove", "resolve", "dismiss"];
const VARIANT: Readonly<Record<ChatReportCloseAction, "danger" | "outline" | "ghost">> = { remove: "danger", resolve: "outline", dismiss: "ghost" };

/**
 * What a view's photos and files do: whether they still open, and what opening, downloading, a photo failing to load and
 * its Try again do.
 */
interface ReportFiles {
  lost: boolean;
  onOpen: (message: AdminChatReportMessageDto, index: number, opener: HTMLElement) => void;
  onDownload: (attachment: AdminChatAttachmentDto) => void;
  onFailed: () => void;
  onRetry: () => void;
}

/**
 * Each message as it reads in the thread, oldest first, with the reported one marked, and its photos and files under it
 * from the links the view came with. Once they no longer open, the photos fail as a photo that didn't load does, and the
 * files lose their Download. Until then, a photo that didn't load fails alone, and loads again from its link.
 */
function ReportedMessages({ messages, files }: { messages: AdminChatReportMessageDto[]; files: ReportFiles }) {
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
          {m.body && <p className="mt-1 whitespace-pre-wrap break-words text-slate-800">{m.body}</p>}
          {m.attachments.length > 0 && (
            <div className="mt-2">
              <AttachmentGrid
                compact
                attachments={m.attachments}
                sourceOf={(a) => (files.lost ? { src: null, broken: true } : { src: a.thumbUrl ?? a.url })}
                onOpen={(index, opener) => files.onOpen(m, index, opener)}
                onDownload={files.lost ? undefined : files.onDownload}
                onImageError={files.onFailed}
                onRetry={files.onRetry}
              />
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

/**
 * Under a thread with photos or files: how long they open for, and once they don't, Try again, which is another view.
 * The links are never fetched again by themselves, as that would be a view nobody chose.
 */
function ReportFilesNote({ lost, retrying, noteRef, retryRef, onRetry }: { lost: boolean; retrying: boolean; noteRef: Ref<HTMLParagraphElement>; retryRef: Ref<HTMLButtonElement>; onRetry: () => void }) {
  const lostId = useId();
  return (
    <div>
      {/* Focused after a Try again that worked, as its button goes. */}
      <p ref={noteRef} tabIndex={-1} className="text-xs text-slate-500 focus:outline-none">
        {CHAT_REPORT_FILES_TEXT}
      </p>
      {/* Mounted while empty, so the warning is read out when it comes. */}
      <div role="status">
        {lost && (
          <Notice tone="warning" className="mt-2">
            <p id={lostId}>{CHAT_REPORT_FILES_LOST_TEXT}</p>
          </Notice>
        )}
      </div>
      {lost && (
        <Button ref={retryRef} size="sm" variant="outline" className="mt-2" aria-describedby={lostId} loading={retrying} onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

function ChatReportRow({ slug, report }: { slug: string; report: AdminChatReportDto }) {
  const qc = useQueryClient();
  // Kept here and nowhere else, the links to its photos and files with it. A query would refetch, and a useMutation would
  // keep the text in the mutation cache, and every fetch writes an audit row.
  const [view, setView] = useState<AdminChatReportViewDto | null>(null);
  // When the view arrived, which its photos and files open for a while after (chatReportFilesOpen).
  const receivedAt = useRef(0);
  // Its photos and files no longer open: their links ran out.
  const [lost, setLost] = useState(false);
  // The photo open over the page, from the view's own links.
  const [viewing, setViewing] = useState<{ messageId: string; index: number; opener: HTMLElement } | null>(null);
  const filesNote = useRef<HTMLParagraphElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  // Once they stop working, what had focus may go (the photo viewer, a photo that becomes a mark, a Download that goes),
  // and focus goes to Try again rather than the page.
  const focusRetry = useRef(false);
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
  useEffect(() => {
    if (!lost || !focusRetry.current) return;
    focusRetry.current = false;
    retryButton.current?.focus();
  }, [lost]);
  // A view, or none, and nothing of the one before: no photo open and no links lost.
  const show = (next: AdminChatReportViewDto | null) => {
    setView(next);
    setLost(false);
    setViewing(null);
  };
  const failed = (e: unknown) => {
    toast.error(errorMessage(e));
    if (isOutOfDate(e)) {
      show(null);
      setModal(null);
      void invalidateTenant(qc, slug);
    }
  };
  /** Views the report, which writes an audit row; true once its answer is shown. */
  const open = async (): Promise<boolean> => {
    const mine = ++latest.current;
    setOpening(true);
    try {
      const result = await api.admin.chatReports.view(slug, report.id);
      if (latest.current !== mine) return false;
      receivedAt.current = Date.now();
      show(result);
      return true;
    } catch (e) {
      if (latest.current === mine) failed(e);
      return false;
    } finally {
      if (latest.current === mine) setOpening(false);
    }
  };
  const close = () => {
    latest.current += 1;
    setOpening(false);
    show(null);
    setModal(null);
  };
  /**
   * The links have run out. Focus goes to Try again when the admin just pressed a photo or a Download (`pressed`), which
   * goes, or the photo viewer was open, which closes; not for a photo failing to load by itself.
   */
  const markLost = (pressed: boolean) => {
    setLost(true);
    if (pressed || viewing) focusRetry.current = true;
    setViewing(null);
  };
  const filesOpen = () => chatReportFilesOpen(receivedAt.current, Date.now());
  // Each checks the links haven't run out first: on the web, following one that has would leave the page for the refusal.
  // A photo that fails to load while they should still work (a dropped request, a stored copy gone) fails alone.
  const files: ReportFiles = {
    lost,
    onOpen: (message, index, opener) => (filesOpen() ? setViewing({ messageId: message.id, index, opener }) : markLost(true)),
    onDownload: (attachment) => (filesOpen() ? downloadFromUrl(attachment.downloadUrl) : markLost(true)),
    onFailed: () => {
      if (!filesOpen()) markLost(false);
    },
    onRetry: () => {
      if (!filesOpen()) markLost(true);
    },
  };
  const retryFiles = async () => {
    if (await open()) filesNote.current?.focus();
  };
  const viewed = viewing && view?.messages.find((m) => m.id === viewing.messageId);
  const viewedPhotos = viewed ? viewed.attachments.filter((a) => a.kind === "PHOTO") : [];
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
    show(null);
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
          {report.targetKind === "MESSAGE" ? <ReportedMessages messages={view.messages} files={files} /> : <p className="whitespace-pre-wrap break-words rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-slate-800">{view.noteSnapshot}</p>}
          {chatReportHasFiles(view) && <ReportFilesNote lost={lost} retrying={opening} noteRef={filesNote} retryRef={retryButton} onRetry={() => void retryFiles()} />}
          {view.resolutionNote && <p className="break-words text-xs text-slate-500">Resolution: {view.resolutionNote}</p>}
          {report.reported && (
            <p className="text-xs text-slate-500">
              To suspend them, open{" "}
              <Link to={`/t/${slug}/admin/members/${report.reported.id}`} className="text-primary-ink underline">
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
      {/* No Report message: this is the report. Download and every photo come from the view's links. */}
      {viewing && viewed && viewedPhotos.length > 0 && (
        <PhotoViewerFrame
          photos={viewedPhotos}
          startIndex={viewing.index}
          who={chatReportSenderLabel(viewed)}
          sentAt={viewed.createdAt}
          opener={viewing.opener}
          srcOf={(photo) => photo.url}
          missing={() => false}
          onDownload={files.onDownload}
          onImageError={files.onFailed}
          onClose={() => setViewing(null)}
        />
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
      {list.isLoading && <ListSkeleton shape="adminRow" />}
      {list.error && <ErrorBox error={list.error} />}
      {list.data && list.data.data.length === 0 && <EmptyState icon={<IconCheck />} title={chatReportEmptyTitle(status)} description={chatReportEmptyText(status)} />}
      {!!list.data?.data.length && (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {list.data.data.map((r) => (
            <ChatReportRow key={r.id} slug={slug} report={r} />
          ))}
        </ul>
      )}
      {list.data && <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onChange={(p) => setParam("page", String(p))} />}
    </div>
  );
}
