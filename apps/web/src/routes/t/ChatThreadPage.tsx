import type { ChatConversationDto, ChatGroupDto, ChatMessageDto } from "@illuminize/shared";
import { chatKeys, conversationTitle, groupMessages, newClientKey, sendLimitNotice, threadItems, type OutboxEntry, type ThreadItem } from "@illuminize/shared/chat";
import { errorMessage, fatalQueryError, isApiClientError, isTransientError } from "@illuminize/shared/client";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
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
import { chatSync, inboxFromParams, inboxQuery, isMuted, patchConversation } from "@/lib/chat";
import { formatDate, pluralize } from "@/lib/format";
import { groupPath, groupsPath, refreshGroup } from "@/lib/groups";
import { useRealtimeStatus } from "@/lib/realtime";
import { draftKey, useChatStore } from "@/stores/chatStore";
import { toast } from "@/stores/uiStore";

const PAGE_SIZE = 30;
const READ_AFTER_MS = 800;

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
  // A group's own details, for the one thing only they say: why its owner can't send yet. Shared with its details screen.
  const group = useQuery({ queryKey: chatKeys.group(slug, id), queryFn: () => api.chat.groups.get(slug, id), enabled: !!conversation.data?.group && !conversation.data.canSend });
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
    const notice = sendLimitNotice(failed?.code);
    if (!notice) return;
    setNotice(notice);
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
  if (error) return <ThreadUnavailable slug={slug} id={id} groupsOn={tenant.settings.features.groups} error={error} backTo={inboxHref} onRetry={() => void conversation.refetch()} />;
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
  const name = conversationTitle(c);
  const muted = isMuted(c, now);
  const profileHref = c.peer && tenant.settings.features.directory ? `/t/${slug}/app/directory/${c.peer.id}` : null;
  const composer = (keyboardOpen: boolean, intro?: string) => <ChatComposer draftKey={dk} onSend={send} notice={notice ?? intro} keyboardOpen={keyboardOpen} autoFocus />;
  const subtitle = c.group ? [pluralize(c.group.memberCount, "member"), c.group.archived && "Archived", muted && "Muted"].filter(Boolean).join(" · ") : muted ? "Muted" : undefined;

  const footer = (keyboardOpen: boolean): ReactNode => {
    if (c.group) {
      if (c.canSend) return composer(keyboardOpen);
      if (c.group.archived) return <Panel title="This group has been archived">You can read it, but nobody can send messages in it any more.</Panel>;
      return <GroupClosedPanel group={group.data} />;
    }
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
            subtitle={subtitle}
            actions={
              <>
                {c.group && (
                  <Link to={groupPath(slug, c.id)} aria-label="Group details" title="Group details" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-primary">
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 11v5M12 8h.01" />
                    </svg>
                  </Link>
                )}
                <button type="button" aria-label="Conversation options" onClick={() => setOptionsOpen(true)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-primary">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
                    <circle cx="5" cy="12" r="2" />
                    <circle cx="12" cy="12" r="2" />
                    <circle cx="19" cy="12" r="2" />
                  </svg>
                </button>
              </>
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
              label={c.group ? `Messages in ${name}` : `Messages with ${name}`}
              me={me}
              showSenders={!!c.group}
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

/**
 * Why the owner of a group can't send in it: only an owner reaches its thread while moderation keeps it from everyone else.
 * Members never see these, because to them such a group isn't there at all.
 */
function GroupClosedPanel({ group }: { group: ChatGroupDto | undefined }) {
  switch (group?.review?.moderationStatus) {
    case "PENDING":
      return <Panel title="Waiting for an admin to approve this group">Nobody else can see it yet. Messages can be sent once it's approved.</Panel>;
    case "REJECTED":
      return <Panel title="An admin didn't approve this group">Members can't see it, and nobody can send messages in it. You can edit it from Group details and send it for review again.</Panel>;
    case "REMOVED":
      return <Panel title="An admin removed this group">Members can't see it, and nobody can send messages in it.</Panel>;
    default:
      return <Panel title="You can't send messages here right now">You can still read the conversation.</Panel>;
  }
}

/** What a group thread this member can't open says about why, from the group's own details where they may see those. */
function groupUnavailable(group: ChatGroupDto): { title: string; text: string } | null {
  switch (group.myState) {
    case "LEFT":
      return { title: "You left this group", text: group.canJoin ? "Join it again to read and send messages." : "You'd need a new invitation to read it again." };
    case "REMOVED":
      return { title: "You were removed from this group", text: "You'd need a new invitation to read it again." };
    case "INVITED":
      return { title: "You've been invited to this group", text: "Accept the invitation to read and send messages." };
    case null:
      return group.canJoin ? { title: "You're not in this group", text: "Join it to read and send messages." } : null;
    default:
      return null;
  }
}

/**
 * A thread that can't be opened says so and offers a way back, and never blanks the app. A group this member has left, been
 * removed from or not joined says which, if they may still see the group at all; an invite-only one they've left reads like
 * anything else that isn't there.
 */
function ThreadUnavailable({ slug, id, groupsOn, error, backTo, onRetry }: { slug: string; id: string; groupsOn: boolean; error: unknown; backTo: string; onRetry: () => void }) {
  const qc = useQueryClient();
  const answered = isApiClientError(error) && !isTransientError(error);
  const off = isApiClientError(error) && error.code === "FEATURE_DISABLED";
  const missing = isApiClientError(error) && error.status === 404;
  const lookup = useQuery({ queryKey: chatKeys.group(slug, id), queryFn: () => api.chat.groups.get(slug, id), enabled: groupsOn && missing, retry: false });
  const join = useMutation({ mutationFn: () => api.chat.groups.join(slug, id), onSuccess: (group) => void refreshGroup(qc, slug, group), onError: (err) => toast.error(errorMessage(err)) });
  // Fresh from the server only: a copy cached while they were in it would say they still are.
  const group = missing && lookup.data && !lookup.isFetching ? lookup.data : null;
  const about = group ? groupUnavailable(group) : null;
  const title = about?.title ?? (off ? "Messages aren't available" : answered ? "This conversation isn't available" : "This conversation couldn't be opened");
  const text = about?.text ?? (off ? errorMessage(error) : answered ? "It may have been removed, or the link may be wrong." : "Check your connection, then try again.");
  const action = "inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
  return (
    <ChatPane>
      {() => (
        <>
          <ChatPaneHeader backTo={backTo} title={about && group ? group.name : "Conversation"} />
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
              {group?.myState !== "INVITED" && group?.canJoin && (
                <Button className="min-h-11" onClick={() => join.mutate()} loading={join.isPending}>
                  Join group
                </Button>
              )}
              {group?.myState === "INVITED" && (
                <Link to={groupsPath(slug, "invitations")} className={clsx(action, "bg-primary text-white hover:opacity-90")}>
                  See invitation
                </Link>
              )}
              {group && about && (
                <Link to={groupPath(slug, id)} className={clsx(action, "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50")}>
                  Group details
                </Link>
              )}
              <Link to={backTo} className={clsx(action, about ? "text-slate-600 hover:bg-slate-100" : "bg-primary text-white hover:opacity-90")}>
                Back to messages
              </Link>
            </div>
          </div>
        </>
      )}
    </ChatPane>
  );
}
