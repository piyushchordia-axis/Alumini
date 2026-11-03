import type { ChatConversationDto, ChatMessageDto } from "@illuminize/shared";
import { chatKeys, groupMessages, newClientKey, threadItems, type OutboxEntry, type ThreadItem } from "@illuminize/shared/chat";
import { errorMessage, fatalQueryError, isApiClientError, isTransientError } from "@illuminize/shared/client";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { BlockConfirmDialog, BlockMemberButton } from "@/components/chat/BlockMemberButton";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { ChatPane, ChatPaneHeader } from "@/components/chat/ChatPane";
import { ConversationOptions } from "@/components/chat/ConversationOptions";
import { MessageList, type MessageActions } from "@/components/chat/MessageList";
import { ReportMessageDialog } from "@/components/chat/ReportMessageDialog";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Button, Loading } from "@/components/ui";
import { useDocumentVisible, useNow, useOpenConversation } from "@/hooks/useChat";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { chatSync, inboxFromParams, inboxQuery, isMuted, patchConversation, peerName } from "@/lib/chat";
import { formatDate } from "@/lib/format";
import { useRealtimeStatus } from "@/lib/realtime";
import { draftKey, useChatStore } from "@/stores/chatStore";
import { toast } from "@/stores/uiStore";

const PAGE_SIZE = 30;
const READ_AFTER_MS = 800;
const SLOW_DOWN = "You're sending messages quickly. Wait a moment, then send again.";

/** Remounts per thread, so nothing about one conversation (scroll position, a half-open dialog) carries into the next. */
export function ChatThreadRoute() {
  const { conversationId = "" } = useParams();
  return <ChatThreadPage key={conversationId} conversationId={conversationId} />;
}

/**
 * Marks the thread read up to the newest message on screen, only while it's actually being looked at: this route is open
 * and the tab is in front. A thread left open in a background tab marks nothing.
 */
function useMarkRead(slug: string, id: string, conversation: ChatConversationDto | undefined, items: ThreadItem[], me: string) {
  const qc = useQueryClient();
  const visible = useDocumentVisible();
  const posted = useRef(0);
  let newest: ChatMessageDto | null = null;
  for (const item of items) if (item.message && (!newest || item.message.seq > newest.seq)) newest = item.message;
  // Sending moves the sender's own read position on the server, so a thread ending in their message has nothing to mark.
  const target = newest && newest.sender?.id !== me && newest.clientKey === null ? newest.seq : 0;
  const readSoFar = conversation?.lastReadSeq ?? 0;
  const loaded = !!conversation;

  useEffect(() => {
    if (!visible || !loaded || target <= Math.max(readSoFar, posted.current)) return;
    const timer = setTimeout(() => {
      posted.current = target;
      api.chat
        .read(slug, id, { seq: target })
        .then(({ lastReadSeq }) => {
          patchConversation(qc, slug, id, (c) => (lastReadSeq > c.lastReadSeq ? { ...c, lastReadSeq, unread: Math.max(c.unread - (lastReadSeq - c.lastReadSeq), 0) } : c));
          // Connected, the server's own event updates the badge on every device.
          if (useRealtimeStatus.getState().status !== "connected") void qc.invalidateQueries({ queryKey: chatKeys.badge(slug) });
        })
        .catch(() => {
          posted.current = 0;
        });
    }, READ_AFTER_MS);
    return () => clearTimeout(timer);
  }, [visible, loaded, target, readSoFar, slug, id, qc]);
}

function Panel({ title, children, actions }: { title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="border-t border-slate-200 bg-slate-50 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      {children && <div className="mt-0.5 text-sm text-slate-600">{children}</div>}
      {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

function ChatThreadPage({ conversationId: id }: { conversationId: string }) {
  const { tenant, membership } = useMembership();
  const slug = tenant.slug;
  const me = membership.id;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const now = useNow();
  useOpenConversation(slug, id);

  const conversation = useQuery({ queryKey: chatKeys.conversation(slug, id), queryFn: () => api.chat.conversation(slug, id) });
  const messages = useInfiniteQuery({
    queryKey: chatKeys.messages(slug, id),
    queryFn: ({ pageParam }) => api.chat.messages(slug, id, { cursor: pageParam, limit: PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  // Written by the chat sync, never fetched. Kept while signed in, so a failed send is still there after leaving and coming back.
  const outboxKey = chatKeys.outbox(slug, id);
  const outbox = useQuery({ queryKey: outboxKey, queryFn: () => qc.getQueryData<OutboxEntry[]>(outboxKey) ?? [], enabled: false, staleTime: Infinity, gcTime: Infinity });

  const items = useMemo(() => threadItems(messages.data, outbox.data), [messages.data, outbox.data]);
  const rows = useMemo(() => groupMessages(items, me, now), [items, me, now]);
  useMarkRead(slug, id, conversation.data, items, me);

  const dk = draftKey(slug, id);
  const setDraft = useChatStore((s) => s.setDraft);
  const [notice, setNotice] = useState<string | null>(null);
  const [reporting, setReporting] = useState<string | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [confirmDecline, setConfirmDecline] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);

  const afterAnswer = (c: ChatConversationDto) => {
    patchConversation(qc, slug, id, () => c);
    void qc.invalidateQueries({ queryKey: chatKeys.lists(slug) });
    void qc.invalidateQueries({ queryKey: chatKeys.badge(slug) });
  };
  const [params, setParams] = useSearchParams();
  const accept = useMutation({
    mutationFn: () => api.chat.accept(slug, id),
    onSuccess: (c) => {
      afterAnswer(c);
      // It's a chat now, so the list beside it shows where it went.
      setParams({}, { replace: true });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const decline = useMutation({
    mutationFn: () => api.chat.decline(slug, id),
    onSuccess: (c) => {
      afterAnswer(c);
      setConfirmDecline(false);
      toast.success("Request declined");
      navigate(`/t/${slug}/app/messages?tab=requests`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  /** What became of a send that didn't go. Too many too fast puts the words back to send later, if the box is free for them. */
  const settleFailure = (clientKey: string, text: string) => {
    const failed = qc.getQueryData<OutboxEntry[]>(outboxKey)?.find((e) => e.clientKey === clientKey);
    if (failed?.code !== "RATE_LIMITED") return;
    setNotice(SLOW_DOWN);
    if (!useChatStore.getState().drafts[dk]) {
      chatSync.discard(slug, id, clientKey);
      setDraft(dk, text);
    }
  };
  const send = (text: string) => {
    setNotice(null);
    setDraft(dk, "");
    const clientKey = newClientKey();
    void chatSync.send(slug, id, text, clientKey).then((sent) => {
      if (!sent) settleFailure(clientKey, text);
    });
  };
  const actions: MessageActions = {
    onRetry: (clientKey) => {
      const text = qc.getQueryData<OutboxEntry[]>(outboxKey)?.find((e) => e.clientKey === clientKey)?.body ?? "";
      setNotice(null);
      void chatSync.retry(slug, id, clientKey).then((sent) => {
        if (!sent) settleFailure(clientKey, text);
      });
    },
    onDiscard: (clientKey) => chatSync.discard(slug, id, clientKey),
    onReport: setReporting,
  };

  const inboxHref = `/t/${slug}/app/messages${inboxQuery(inboxFromParams(params))}`;
  // Only an answer, or nothing at all to show: a refetch that fails in the background keeps the thread and the draft on screen.
  const error = fatalQueryError(conversation);
  if (error) return <ThreadUnavailable error={error} backTo={inboxHref} onRetry={() => void conversation.refetch()} />;
  if (!conversation.data) {
    return (
      <ChatPane>
        {() => (
          <>
            <ChatPaneHeader backTo={inboxHref} title="Conversation" />
            <Loading />
          </>
        )}
      </ChatPane>
    );
  }

  const c = conversation.data;
  const name = peerName(c.peer);
  const muted = isMuted(c, now);
  const profileHref = c.peer && tenant.settings.features.directory ? `/t/${slug}/app/directory/${c.peer.id}` : null;
  const composer = (keyboardOpen: boolean, intro?: string) => <ChatComposer draftKey={dk} onSend={send} notice={notice ?? intro} keyboardOpen={keyboardOpen} autoFocus />;

  const footer = (keyboardOpen: boolean): ReactNode => {
    if (!c.peer) return <Panel title="This member deleted their account">You can read the conversation, but not reply.</Panel>;
    if (c.blockedByMe)
      return (
        <Panel title={`You blocked ${name}`} actions={<BlockMemberButton slug={slug} member={c.peer} blocked size="md" />}>
          Unblock them to send messages. Anything they sent while blocked stays hidden.
        </Panel>
      );
    switch (c.state) {
      case "REQUEST_RECEIVED":
        return (
          <Panel
            title={`${name} wants to send you a message`}
            actions={
              <>
                <Button className="min-h-11" onClick={() => accept.mutate()} loading={accept.isPending}>
                  Accept request
                </Button>
                <Button variant="outline" className="min-h-11" onClick={() => setConfirmDecline(true)}>
                  Decline request
                </Button>
                <BlockMemberButton slug={slug} member={c.peer} blocked={false} variant="ghost" size="md" />
              </>
            }
          >
            Accept to reply. If you decline, they won't be told.
          </Panel>
        );
      case "REQUEST_DECLINED":
        return (
          <Panel
            title="You declined this request"
            actions={
              <Button variant="outline" className="min-h-11" onClick={() => accept.mutate()} loading={accept.isPending}>
                Accept request
              </Button>
            }
          >
            {name} hasn't been told.
          </Panel>
        );
      case "REQUEST_SENT":
        if (c.canSend) return composer(keyboardOpen, `Request sent. Sending another message asks ${name} again.`);
        return (
          <Panel title="Request sent">
            You can send more once {name} accepts.
            {c.canRerequestAt && ` If they haven't by ${formatDate(c.canRerequestAt)}, you can ask again then.`}
          </Panel>
        );
      case "CLOSED":
        if (c.canSend) return composer(keyboardOpen, `This conversation closed. Sending a message asks ${name} again.`);
        return <Panel title="This conversation has closed">{c.canRerequestAt ? `You can send a new request from ${formatDate(c.canRerequestAt)}.` : "You can read it, but not reply."}</Panel>;
      case "ACCEPTED":
        if (c.canSend) return composer(keyboardOpen);
        return <Panel title={`You can't message ${name} right now`}>You can still read the conversation.</Panel>;
    }
  };

  const loadingFirst = messages.isLoading;
  const firstLoadFailed = !messages.data && !!messages.error;

  return (
    <ChatPane>
      {(keyboardOpen) => (
        <>
          <ChatPaneHeader
            backTo={inboxHref}
            title={name}
            member={c.peer}
            profileHref={profileHref}
            subtitle={muted ? "Muted" : undefined}
            actions={
              <button type="button" aria-label="Conversation options" onClick={() => setOptionsOpen(true)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-primary">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
                  <circle cx="5" cy="12" r="2" />
                  <circle cx="12" cy="12" r="2" />
                  <circle cx="19" cy="12" r="2" />
                </svg>
              </button>
            }
          />
          {loadingFirst ? (
            <div className="flex-1">
              <Loading label="Loading messages…" />
            </div>
          ) : firstLoadFailed ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-sm text-slate-600">{errorMessage(messages.error, "Messages couldn't be loaded.")}</p>
              <Button variant="outline" className="min-h-11" onClick={() => void messages.refetch()}>
                Retry loading
              </Button>
            </div>
          ) : (
            <MessageList
              rows={rows}
              label={`Messages with ${name}`}
              hasOlder={!!messages.hasNextPage}
              loadingOlder={messages.isFetchingNextPage}
              loadOlder={() => void messages.fetchNextPage()}
              actions={actions}
              before={rows.length === 0 ? <p className="py-10 text-center text-sm text-slate-500">No messages yet.</p> : undefined}
            />
          )}
          {footer(keyboardOpen)}
          <ConversationOptions slug={slug} conversation={c} open={optionsOpen} onClose={() => setOptionsOpen(false)} onBlock={() => setConfirmBlock(true)} />
          {c.peer && <BlockConfirmDialog slug={slug} member={c.peer} open={confirmBlock} onClose={() => setConfirmBlock(false)} />}
          <ReportMessageDialog slug={slug} messageId={reporting} onClose={() => setReporting(null)} />
          <ConfirmDialog
            open={confirmDecline}
            title="Decline this request?"
            body={`${name} won't be told, and the request leaves your inbox.`}
            confirmLabel="Decline request"
            destructive
            busy={decline.isPending}
            onConfirm={() => decline.mutate()}
            onCancel={() => setConfirmDecline(false)}
          />
        </>
      )}
    </ChatPane>
  );
}

/** A thread that can't be opened says so and offers a way back, and never blanks the app. */
function ThreadUnavailable({ error, backTo, onRetry }: { error: unknown; backTo: string; onRetry: () => void }) {
  const answered = isApiClientError(error) && !isTransientError(error);
  const off = isApiClientError(error) && error.code === "FEATURE_DISABLED";
  const title = off ? "Messages aren't available" : answered ? "This conversation isn't available" : "This conversation couldn't be opened";
  const text = off ? errorMessage(error) : answered ? "It may have been removed, or the link may be wrong." : "Check your connection, then try again.";
  return (
    <ChatPane>
      {() => (
        <>
          <ChatPaneHeader backTo={backTo} title="Conversation" />
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
            <div className="text-3xl" aria-hidden>
              💬
            </div>
            <p className="text-base font-semibold text-slate-800">{title}</p>
            <p className="max-w-sm text-sm text-slate-500">{text}</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {!answered && (
                <Button variant="outline" className="min-h-11" onClick={onRetry}>
                  Retry loading
                </Button>
              )}
              <Link to={backTo} className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-medium text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                Back to messages
              </Link>
            </div>
          </div>
        </>
      )}
    </ChatPane>
  );
}
