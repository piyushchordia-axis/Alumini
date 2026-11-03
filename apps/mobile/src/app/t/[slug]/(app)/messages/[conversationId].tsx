import type { ChatConversationDto, ChatMessageDto } from "@illuminize/shared";
import { chatKeys, groupMessages, isMuted, newClientKey, peerName, threadItems, type ChatRow, type OutboxEntry, type ThreadItem } from "@illuminize/shared/chat";
import { errorMessage, fatalQueryError, isApiClientError, isTransientError } from "@illuminize/shared/client";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FlatList, Platform, Pressable, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlockConfirmSheet, BlockMemberButton } from "@/components/chat/BlockMember";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { ChatHeader, ChatNotice, ChatOff, ChatScreen, iconButton, StatusLine, useLeaveChatScreen } from "@/components/chat/ChatFrame";
import { ConversationOptionsSheet, ReportMessageSheet } from "@/components/chat/ChatSheets";
import { DayRow, MessageRow, type MessageActions } from "@/components/chat/MessageRow";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { Button, ErrorText, Spinner } from "@/components/ui";
import { useAppActive, useChatEnabled, useNow, useOpenConversation } from "@/hooks/useChat";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { chatSync, patchConversation } from "@/lib/chat";
import { formatDate } from "@/lib/format";
import { useRealtimeStatus } from "@/lib/realtime";
import { draftKey, useChatStore } from "@/stores/chatStore";
import { colors, spacing } from "@/theme";

const PAGE_SIZE = 30;
const READ_AFTER_MS = 800;
/** Close enough to the newest message to count as reading it. The list is inverted, so this is the distance from the bottom. */
const PINNED_WITHIN = 80;
const SLOW_DOWN = "You're sending messages quickly. Wait a moment, then send again.";

export default function ConversationScreen() {
  const enabled = useChatEnabled();
  const { conversationId = "" } = useLocalSearchParams<{ conversationId: string }>();
  if (!enabled) return <ChatOff />;
  // Keyed, so nothing about one conversation (scroll position, a half-open sheet) carries into the next.
  return <Thread key={conversationId} id={conversationId} />;
}

/**
 * Marks the thread read up to the newest message on screen, only while it's actually being looked at: this screen is
 * focused and the app is in front. A thread under another screen, or in an app in the background, marks nothing.
 */
function useMarkRead(slug: string, id: string, conversation: ChatConversationDto | undefined, items: ThreadItem[], me: string) {
  const qc = useQueryClient();
  const focused = useIsFocused();
  const active = useAppActive();
  const posted = useRef(0);
  let newest: ChatMessageDto | null = null;
  for (const item of items) if (item.message && (!newest || item.message.seq > newest.seq)) newest = item.message;
  // Sending moves the sender's own read position on the server, so a thread ending in their message has nothing to mark.
  const target = newest && newest.sender?.id !== me && newest.clientKey === null ? newest.seq : 0;
  const readSoFar = conversation?.lastReadSeq ?? 0;
  const loaded = !!conversation;
  const looking = focused && active;

  useEffect(() => {
    if (!looking || !loaded || target <= Math.max(readSoFar, posted.current)) return;
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
  }, [looking, loaded, target, readSoFar, slug, id, qc]);
}

/** In place of the composer: why there's nothing to write in, and what can be done instead. */
function Panel({ title, children, actions }: { title: string; children?: ReactNode; actions?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.card, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: Math.max(insets.bottom, spacing.md), gap: 4 }}>
      <Text style={{ fontSize: 14, fontWeight: "700", color: colors.text }}>{title}</Text>
      {children ? <Text style={{ fontSize: 14, color: colors.muted }}>{children}</Text> : null}
      {actions ? <View style={{ marginTop: spacing.sm, gap: spacing.sm }}>{actions}</View> : null}
    </View>
  );
}

function Thread({ id }: { id: string }) {
  const { tenant, membership } = useMembership();
  const slug = tenant.slug;
  const me = membership.id;
  const qc = useQueryClient();
  const now = useNow();
  const router = useRouter();
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
  // Newest first, for a list drawn from the bottom up.
  const data = useMemo(() => [...rows].reverse(), [rows]);
  useMarkRead(slug, id, conversation.data, items, me);

  const dk = draftKey(slug, id);
  const setDraft = useChatStore((s) => s.setDraft);
  const [notice, setNotice] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [reporting, setReporting] = useState<string | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [confirmDecline, setConfirmDecline] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);

  // What just happened, for a few seconds.
  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(null), 6000);
    return () => clearTimeout(timer);
  }, [status]);

  const afterAnswer = (c: ChatConversationDto) => {
    patchConversation(qc, slug, id, () => c);
    void qc.invalidateQueries({ queryKey: chatKeys.lists(slug) });
    void qc.invalidateQueries({ queryKey: chatKeys.badge(slug) });
  };
  const setInbox = useChatStore((s) => s.setInbox);
  const accept = useMutation({
    mutationFn: () => api.chat.accept(slug, id),
    onSuccess: (c) => {
      afterAnswer(c);
      // It's a chat now, so the inbox shows where it went when they go back, as on the web app.
      setInbox("MAIN");
    },
  });
  const decline = useMutation({
    mutationFn: () => api.chat.decline(slug, id),
    onSuccess: (c) => {
      afterAnswer(c);
      setConfirmDecline(false);
      // To the other requests, as on the web app, also when a push opened this with only the anchor tab underneath:
      // dismissTo goes back to the tabs if they're below, and puts the inbox in place of this screen if not.
      setInbox("REQUESTS");
      router.dismissTo(`/t/${slug}/messages`);
    },
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

  // Scrolling. The list is inverted, so an offset of 0 is the newest message.
  const listRef = useRef<FlatList<ChatRow>>(null);
  const pinnedRef = useRef(true);
  const [pinned, setPinned] = useState(true);
  const newest = data.find((r): r is Extract<ChatRow, { type: "message" }> => r.type === "message");
  const newestKey = newest?.key;
  const newestRef = useRef(newestKey);
  useEffect(() => {
    newestRef.current = newestKey;
  }, [newestKey]);
  // The newest message when the member scrolled away from it: anything newer is news to them.
  const [seenKey, setSeenKey] = useState<string | undefined>(undefined);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const atBottom = e.nativeEvent.contentOffset.y <= PINNED_WITHIN;
    if (atBottom === pinnedRef.current) return;
    pinnedRef.current = atBottom;
    setPinned(atBottom);
    if (!atBottom) setSeenKey(newestRef.current);
  };
  const jumpToLatest = () => listRef.current?.scrollToOffset({ offset: 0, animated: true });
  // Their own message always brings them back down to it.
  const newestMine = !!newest?.mine;
  useEffect(() => {
    if (newestMine && !pinnedRef.current) listRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, [newestKey, newestMine]);

  // Only an answer, or nothing at all to show: a refetch that fails in the background keeps the thread and the draft on screen.
  const error = fatalQueryError(conversation);
  if (error) return <ThreadUnavailable error={error} onRetry={() => void conversation.refetch()} />;
  if (!conversation.data) {
    return (
      <ChatScreen>
        <ChatHeader title="Conversation" />
        <Spinner label="Loading conversation…" />
      </ChatScreen>
    );
  }

  const c = conversation.data;
  const name = peerName(c.peer);
  const muted = isMuted(c, now);
  const composer = (intro?: string) => <ChatComposer draftKey={dk} onSend={send} notice={notice ?? intro} />;

  const footer = (): ReactNode => {
    if (!c.peer) return <Panel title="This member deleted their account">You can read the conversation, but not reply.</Panel>;
    if (c.blockedByMe)
      return (
        <Panel title={`You blocked ${name}`} actions={<BlockMemberButton slug={slug} member={c.peer} blocked onChange={() => setStatus(`${name} is unblocked`)} />}>
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
                <Button title="Accept request" loading={accept.isPending} onPress={() => accept.mutate()} />
                <Button title="Decline request" variant="outline" onPress={() => setConfirmDecline(true)} />
                <BlockMemberButton slug={slug} member={c.peer} blocked={false} variant="ghost" />
                <ErrorText error={accept.error} />
              </>
            }
          >
            {"Accept to reply. If you decline, they won't be told."}
          </Panel>
        );
      case "REQUEST_DECLINED":
        return (
          <Panel
            title="You declined this request"
            actions={
              <>
                <Button title="Accept request" variant="outline" loading={accept.isPending} onPress={() => accept.mutate()} />
                <ErrorText error={accept.error} />
              </>
            }
          >
            {`${name} hasn't been told.`}
          </Panel>
        );
      case "REQUEST_SENT":
        if (c.canSend) return composer(`Request sent. Sending another message asks ${name} again.`);
        return (
          <Panel title="Request sent">
            You can send more once {name} accepts.
            {c.canRerequestAt ? ` If they haven't by ${formatDate(c.canRerequestAt)}, you can ask again then.` : ""}
          </Panel>
        );
      case "CLOSED":
        if (c.canSend) return composer(`This conversation closed. Sending a message asks ${name} again.`);
        return <Panel title="This conversation has closed">{c.canRerequestAt ? `You can send a new request from ${formatDate(c.canRerequestAt)}.` : "You can read it, but not reply."}</Panel>;
      case "ACCEPTED":
        if (c.canSend) return composer();
        return <Panel title={`You can't message ${name} right now`}>You can still read the conversation.</Panel>;
    }
  };

  const firstLoadFailed = !messages.data && !!messages.error;
  const hasNew = !pinned && newestKey !== seenKey;

  return (
    <ChatScreen>
      <ChatHeader
        title={name}
        member={c.peer}
        subtitle={muted ? "Muted" : undefined}
        actions={
          <Pressable onPress={() => setOptionsOpen(true)} accessibilityRole="button" accessibilityLabel="Conversation options" style={({ pressed }) => [iconButton, pressed ? { backgroundColor: colors.bg } : null]}>
            <Text accessible={false} style={{ fontSize: 22, color: colors.muted }}>
              ⋯
            </Text>
          </Pressable>
        }
      />
      <View style={{ flex: 1 }}>
        {messages.isLoading ? (
          <Spinner label="Loading messages…" />
        ) : firstLoadFailed ? (
          <ChatNotice title="Messages couldn't be loaded" text={errorMessage(messages.error)}>
            <Button title="Retry loading" variant="outline" onPress={() => void messages.refetch()} />
          </ChatNotice>
        ) : (
          <FlatList
            ref={listRef}
            role="log"
            accessibilityLabel={`Messages with ${name}`}
            inverted
            data={data}
            keyExtractor={(row) => row.key}
            onScroll={onScroll}
            scrollEventThrottle={100}
            onEndReached={() => {
              if (messages.hasNextPage && !messages.isFetchingNextPage) void messages.fetchNextPage();
            }}
            onEndReachedThreshold={0.4}
            // Older pages land at the far end; a new message lands here, and stays out of the way while the member reads back.
            maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: PINNED_WITHIN }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            contentContainerStyle={{ paddingVertical: spacing.md }}
            ListFooterComponent={
              messages.hasNextPage ? (
                <View style={{ alignItems: "center", paddingBottom: spacing.sm }}>
                  <Button title="Load earlier messages" variant="ghost" loading={messages.isFetchingNextPage} onPress={() => void messages.fetchNextPage()} />
                </View>
              ) : undefined
            }
            ListEmptyComponent={<Text style={{ textAlign: "center", color: colors.muted, paddingVertical: spacing.xl }}>No messages yet.</Text>}
            renderItem={({ item: row }) =>
              row.type === "day" ? <DayRow label={row.label} /> : <MessageRow row={row} actions={actions} selected={selected === row.key} onSelect={() => setSelected((s) => (s === row.key ? null : row.key))} />
            }
          />
        )}
        {!pinned && (
          <Pressable
            onPress={jumpToLatest}
            accessibilityRole="button"
            accessibilityLabel={hasNew ? "New messages" : "Jump to latest"}
            style={{ position: "absolute", bottom: spacing.md, alignSelf: "center", minHeight: 44, borderRadius: 22, paddingHorizontal: spacing.lg, backgroundColor: colors.text, flexDirection: "row", alignItems: "center", gap: 6 }}
          >
            <Text style={{ color: "#fff", fontSize: 14, fontWeight: "600" }}>{hasNew ? "New messages" : "Jump to latest"}</Text>
            <Text accessible={false} style={{ color: "#fff" }}>
              ↓
            </Text>
          </Pressable>
        )}
      </View>
      <StatusLine text={status} />
      {footer()}

      <ConversationOptionsSheet slug={slug} conversation={c} open={optionsOpen} onClose={() => setOptionsOpen(false)} onBlock={() => setConfirmBlock(true)} onStatus={setStatus} />
      {c.peer && <BlockConfirmSheet slug={slug} member={c.peer} open={confirmBlock} onClose={() => setConfirmBlock(false)} onDone={() => setStatus(`${name} is blocked`)} />}
      <ReportMessageSheet
        slug={slug}
        messageId={reporting}
        onClose={() => setReporting(null)}
        onDone={(text) => {
          setReporting(null);
          setSelected(null);
          setStatus(text);
        }}
      />
      <ConfirmSheet
        open={confirmDecline}
        title="Decline this request?"
        body={`${name} won't be told, and the request leaves your inbox.`}
        confirmLabel="Decline request"
        destructive
        busy={decline.isPending}
        error={decline.error}
        onConfirm={() => decline.mutate()}
        onCancel={() => {
          decline.reset();
          setConfirmDecline(false);
        }}
      />
    </ChatScreen>
  );
}

/** A thread that can't be opened says so and offers a way back, and never blanks the app. */
function ThreadUnavailable({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const leave = useLeaveChatScreen();
  const qc = useQueryClient();
  const { tenant } = useMembership();
  const answered = isApiClientError(error) && !isTransientError(error);
  const off = isApiClientError(error) && error.code === "FEATURE_DISABLED";
  // Whatever it was, the inbox may still be offering it. Not this thread's own query: with nothing cached, refetching it
  // would put this screen back to loading, and its answer would bring it here again, round and round.
  useEffect(() => {
    if (!answered) return;
    void qc.invalidateQueries({ queryKey: chatKeys.lists(tenant.slug) });
    void qc.invalidateQueries({ queryKey: chatKeys.badge(tenant.slug) });
  }, [answered, qc, tenant.slug]);
  const title = off ? "Messages aren't available" : answered ? "This conversation isn't available" : "This conversation couldn't be opened";
  const text = off ? errorMessage(error) : answered ? "It may have been removed, or the link may be wrong." : "Check your connection, then try again.";
  return (
    <ChatScreen>
      <ChatHeader title="Conversation" />
      <ChatNotice title={title} text={text}>
        {!answered && <Button title="Retry loading" variant="outline" onPress={onRetry} />}
        <Button title="Go back" onPress={leave} />
      </ChatNotice>
    </ChatScreen>
  );
}
