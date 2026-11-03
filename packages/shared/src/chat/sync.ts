import { ApiClientError, errorMessage, isApiClientError, isTransientError } from "../client/ApiClientError";
import type { ChatInbox } from "../constants";
import { CHAT_INBOXES } from "../constants";
import type { RealtimeClient } from "../realtime/client";
import type { ChatBadgeDto, ChatConversationDto, ChatMessageDto, CursorPage } from "../types/dto";
import { addToOutbox, highestSeq, keepNewestPage, markLastMessageRemoved, markMessageRemoved, markOutboxFailed, removeFromOutbox, upsertLiveMessage, type ChatMessagePages, type OutboxEntry } from "./cache";
import { chatKeys } from "./keys";

type QueryKey = readonly unknown[];

/** The part of a TanStack QueryClient this uses, which keeps this code free of React and of any one TanStack package. */
export interface ChatQueryClient {
  getQueryData(key: QueryKey): unknown;
  setQueryData(key: QueryKey, updater: (old: never) => unknown): unknown;
  getQueryState(key: QueryKey): { fetchStatus: string } | undefined;
  invalidateQueries(filters: { queryKey: QueryKey; refetchType?: "active" | "none" }): unknown;
}

export interface ChatSyncApi {
  messages(slug: string, id: string, query: { afterSeq: string; limit: number }): Promise<CursorPage<ChatMessageDto>>;
  /** `signal` aborts a send that has waited too long, so a request that never answers doesn't hold up the ones behind it. */
  send(slug: string, id: string, input: { body: string; clientKey: string }, options?: { signal?: AbortSignal }): Promise<ChatMessageDto>;
}

export interface ChatSyncOptions {
  realtime: Pick<RealtimeClient, "on" | "onReconnect">;
  api: ChatSyncApi;
  queryClient: ChatQueryClient;
  /** The institution on screen, and the thread if one is open. */
  getActive(): { slug: string; conversationId: string | null } | null;
  /** Second catch-up after a reconnect. Rooms are joined just after connecting, so an event can fall between the first fetch and the join. */
  refillAfterMs?: number;
  /** Refetch limits, so a busy thread doesn't refetch once per message. */
  badgeEveryMs?: number;
  listsEveryMs?: number;
  /**
   * How long a send may go unanswered before it counts as failed and can be tried again. Sends to a thread go one at a time,
   * and fetch sets no limit of its own (React Native's sets none at all), so without this one lost request would hold every
   * message after it at "Sending…" with no way to retry or discard.
   */
  sendTimeoutMs?: number;
}

export interface ChatSync {
  /** Starts listening. Returns the function that stops, which also cancels anything scheduled. */
  attach(): () => void;
  /** Fetches whatever came after `afterSeq`, or after the newest message held for this thread. */
  fillGap(slug: string, conversationId: string, afterSeq?: number): Promise<void>;
  /**
   * Shows the message straight away and posts it, after any send to the same thread still under way. Returns the server's
   * copy, or null if it failed, which leaves it in the outbox.
   */
  send(slug: string, conversationId: string, body: string, clientKey?: string): Promise<ChatMessageDto | null>;
  /** Sends a failed message again under its own key, so the server can tell if the first attempt arrived after all. */
  retry(slug: string, conversationId: string, clientKey: string): Promise<ChatMessageDto | null>;
  discard(slug: string, conversationId: string, clientKey: string): void;
}

const BIT = 0x100000000;

/** 36 URL-safe characters shaped like a v4 UUID. Not crypto.randomUUID, which Hermes doesn't promise. */
export function newClientKey(): string {
  const values = new Uint32Array(4);
  const source = (globalThis as { crypto?: { getRandomValues?: (a: Uint32Array) => Uint32Array } }).crypto;
  if (source?.getRandomValues) source.getRandomValues(values);
  else for (let i = 0; i < 4; i++) values[i] = Math.floor(Math.random() * BIT);
  const hex = [...values].map((v) => v.toString(16).padStart(8, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${"89ab"[parseInt(hex[16]!, 16) & 3]}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const GAP_PAGE_SIZE = 50;
const SEND_TIMEOUT_MS = 20_000;
const SEND_TIMED_OUT = "Sending took too long. Check your connection, then try again.";

/**
 * Keeps the chat cache current from live events. One of these runs per app, and screens read the cache. Delivery is at
 * most once and Postgres holds the truth, so anything that may have been missed is fetched: after a reconnect, and when a
 * live event shows a jump in `seq`. A fetch that finds nothing is fine, because messages withheld from this member leave
 * gaps that will never fill.
 */
export function createChatSync(opts: ChatSyncOptions): ChatSync {
  const { api, queryClient: qc, realtime } = opts;
  const refillAfterMs = opts.refillAfterMs ?? 3000;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const filling = new Set<string>();
  const fillAgain = new Map<string, number>();
  const lastRun = new Map<string, number>();
  const waiting = new Set<string>();
  // Removals heard of while running. A gap fill read before one can land after it, when the message wasn't loaded to patch.
  const removedIds = new Set<string>();

  const later = (fn: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn();
    }, ms);
    timers.add(timer);
  };

  /** At once if it hasn't run lately, otherwise once at the end of the window. */
  const throttled = (id: string, everyMs: number, run: () => void) => {
    const since = Date.now() - (lastRun.get(id) ?? -Infinity);
    if (since >= everyMs) {
      lastRun.set(id, Date.now());
      run();
    } else if (!waiting.has(id)) {
      waiting.add(id);
      later(() => {
        waiting.delete(id);
        lastRun.set(id, Date.now());
        run();
      }, everyMs - since);
    }
  };
  const refreshBadge = (slug: string) => throttled(`badge:${slug}`, opts.badgeEveryMs ?? 30_000, () => void qc.invalidateQueries({ queryKey: chatKeys.badge(slug) }));
  const refreshLists = (slug: string) => throttled(`lists:${slug}`, opts.listsEveryMs ?? 2000, () => void qc.invalidateQueries({ queryKey: chatKeys.lists(slug) }));
  /** Discover, My groups and Invitations: a group's members, name or owner changing can move it in any of them. */
  const refreshGroupLists = (slug: string) => throttled(`groups:${slug}`, opts.listsEveryMs ?? 2000, () => void qc.invalidateQueries({ queryKey: chatKeys.groupLists(slug) }));

  const isOpen = (slug: string, id: string) => {
    const active = opts.getActive();
    return active?.slug === slug && active.conversationId === id;
  };

  /** For after patching a query: a fetch under way captured its data before the patch and would overwrite it. */
  const refetchIfFetching = (key: QueryKey) => {
    if (qc.getQueryState(key)?.fetchStatus === "fetching") void qc.invalidateQueries({ queryKey: key });
  };

  /** Puts a message in the thread and settles its outbox entry, in whichever order the response and the socket echo land. */
  const settle = (slug: string, id: string, incoming: ChatMessageDto) => {
    const key = chatKeys.messages(slug, id);
    const message = removedIds.has(incoming.id) ? { ...incoming, body: null, removed: true } : incoming;
    qc.setQueryData(key, (old: ChatMessagePages | undefined) => upsertLiveMessage(old, message));
    if (message.clientKey) qc.setQueryData(chatKeys.outbox(slug, id), (old: OutboxEntry[] | undefined) => removeFromOutbox(old, message.clientKey));
    // With nothing loaded there was nothing to patch.
    if (!qc.getQueryData(key)) void qc.invalidateQueries({ queryKey: key });
    else refetchIfFetching(key);
  };

  const fillGap = async (slug: string, id: string, afterSeq?: number): Promise<void> => {
    const key = `${slug}:${id}`;
    const messagesKey = chatKeys.messages(slug, id);
    const held = qc.getQueryData(messagesKey) as ChatMessagePages | undefined;
    // Nothing loaded yet: the screen's own first fetch covers it. Loaded and empty still wants what comes first.
    if (afterSeq === undefined && !held) return;
    const after = afterSeq ?? highestSeq(held) ?? 0;
    if (filling.has(key)) {
      fillAgain.set(key, Math.min(after, fillAgain.get(key) ?? after));
      return;
    }
    filling.add(key);
    try {
      const page = await api.messages(slug, id, { afterSeq: String(after), limit: GAP_PAGE_SIZE });
      if (page.nextCursor) {
        // Too far behind to stitch on without leaving a hole, so start again from the newest page.
        qc.setQueryData(messagesKey, (old: ChatMessagePages | undefined) => keepNewestPage(old));
        void qc.invalidateQueries({ queryKey: messagesKey });
      } else {
        for (const message of page.data) settle(slug, id, message);
      }
    } catch {
      void qc.invalidateQueries({ queryKey: messagesKey });
    } finally {
      filling.delete(key);
      const again = fillAgain.get(key);
      if (again !== undefined) {
        fillAgain.delete(key);
        await fillGap(slug, id, again);
      }
    }
  };

  /** A message arriving live or as a send's response. A jump past the newest one held means something in between went missing. */
  const receive = (slug: string, id: string, message: ChatMessageDto) => {
    const key = chatKeys.messages(slug, id);
    const before = highestSeq(qc.getQueryData(key) as ChatMessagePages | undefined);
    settle(slug, id, message);
    if (before === null || message.seq <= before + 1) return;
    if (isOpen(slug, id)) void fillGap(slug, id, before);
    else void qc.invalidateQueries({ queryKey: key, refetchType: "none" });
  };

  const catchUp = () => {
    const active = opts.getActive();
    if (!active) return;
    const { slug, conversationId } = active;
    void qc.invalidateQueries({ queryKey: chatKeys.badge(slug) });
    for (const inbox of CHAT_INBOXES as readonly ChatInbox[]) {
      qc.setQueryData(chatKeys.list(slug, inbox), (old: { pages: unknown[]; pageParams: unknown[] } | undefined) => keepNewestPage(old));
    }
    void qc.invalidateQueries({ queryKey: chatKeys.lists(slug) });
    void qc.invalidateQueries({ queryKey: chatKeys.groupLists(slug) });
    // Threads not on screen are refetched when next opened.
    void qc.invalidateQueries({ queryKey: chatKeys.threads(slug), refetchType: "none" });
    if (!conversationId) return;
    void qc.invalidateQueries({ queryKey: chatKeys.conversation(slug, conversationId) });
    // A removal missed while away is of a message already held, which a fill won't read again because it starts after those.
    void qc.invalidateQueries({ queryKey: chatKeys.messages(slug, conversationId) });
    void fillGap(slug, conversationId);
    later(() => {
      const now = opts.getActive();
      if (now?.slug === slug && now.conversationId === conversationId) void fillGap(slug, conversationId);
    }, refillAfterMs);
  };

  /**
   * Posts one send, failing it as a network error once it has waited `sendTimeoutMs`. The server may still have taken it, which
   * is safe: trying again sends the same key and gets the original back, and its echo settles the bubble meanwhile.
   */
  const sendTimeoutMs = opts.sendTimeoutMs ?? SEND_TIMEOUT_MS;
  const sendOnce = (slug: string, id: string, entry: OutboxEntry) =>
    new Promise<ChatMessageDto>((resolve, reject) => {
      const controller = typeof AbortController === "function" ? new AbortController() : undefined;
      const timer = setTimeout(() => {
        controller?.abort();
        reject(new ApiClientError(0, "NETWORK_ERROR", SEND_TIMED_OUT));
      }, sendTimeoutMs);
      api.send(slug, id, { body: entry.body, clientKey: entry.clientKey }, { signal: controller?.signal }).then(
        (message) => {
          clearTimeout(timer);
          resolve(message);
        },
        (err: unknown) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });

  const deliver = async (slug: string, id: string, entry: OutboxEntry): Promise<ChatMessageDto | null> => {
    try {
      const message = await sendOnce(slug, id, entry);
      receive(slug, id, message);
      refreshLists(slug);
      // Outside an accepted chat a send changes the thread itself: someone asking again has used their one message, and the
      // screen must stop offering the box. The server tells this member's other devices; this is the one that sent it.
      const conversationKey = chatKeys.conversation(slug, id);
      if ((qc.getQueryData(conversationKey) as ChatConversationDto | undefined)?.state !== "ACCEPTED") void qc.invalidateQueries({ queryKey: conversationKey });
      return message;
    } catch (err) {
      const retryable = isTransientError(err);
      qc.setQueryData(chatKeys.outbox(slug, id), (old: OutboxEntry[] | undefined) => markOutboxFailed(old, entry.clientKey, errorMessage(err), retryable, isApiClientError(err) ? err.code : undefined));
      // The API refused it, so what the screen believes about this thread is out of date.
      if (!retryable) void qc.invalidateQueries({ queryKey: chatKeys.conversation(slug, id) });
      return null;
    }
  };

  // One send at a time per thread. Two requests in flight together can reach the server in either order, and the thread
  // would then show them in the order they landed rather than the order they were written.
  const inFlight = new Map<string, Promise<unknown>>();
  const post = (slug: string, id: string, entry: OutboxEntry): Promise<ChatMessageDto | null> => {
    qc.setQueryData(chatKeys.outbox(slug, id), (old: OutboxEntry[] | undefined) => addToOutbox(old, entry));
    const key = `${slug}:${id}`;
    const before = inFlight.get(key);
    // Nothing ahead of it goes at once, so a lone send isn't held back even a tick.
    const sent = before ? before.then(() => deliver(slug, id, entry)) : deliver(slug, id, entry);
    inFlight.set(key, sent);
    void sent.then(() => {
      if (inFlight.get(key) === sent) inFlight.delete(key);
    });
    return sent;
  };

  return {
    attach() {
      const stops = [
        realtime.on("chat:message", ({ tenantSlug: slug, conversationId: id, message }) => {
          receive(slug, id, message);
          refreshLists(slug);
          refreshBadge(slug);
        }),
        realtime.on("chat:read", ({ tenantSlug: slug, conversationId: id, lastReadSeq }) => {
          const key = chatKeys.conversation(slug, id);
          qc.setQueryData(key, (old: ChatConversationDto | undefined) => (old && lastReadSeq > old.lastReadSeq ? { ...old, lastReadSeq, unread: Math.max(old.unread - (lastReadSeq - old.lastReadSeq), 0) } : old));
          refetchIfFetching(key);
          refreshLists(slug);
        }),
        realtime.on("chat:removed", ({ tenantSlug: slug, conversationId: id, messageId, seq }) => {
          removedIds.add(messageId);
          const key = chatKeys.messages(slug, id);
          qc.setQueryData(key, (old: ChatMessagePages | undefined) => markMessageRemoved(old, messageId));
          refetchIfFetching(key);
          const conversationKey = chatKeys.conversation(slug, id);
          qc.setQueryData(conversationKey, (old: ChatConversationDto | undefined) => markLastMessageRemoved(old, seq));
          refetchIfFetching(conversationKey);
          refreshLists(slug);
        }),
        realtime.on("chat:changed", ({ tenantSlug: slug, conversationId: id }) => {
          void qc.invalidateQueries({ queryKey: chatKeys.conversation(slug, id) });
          // A group's details and members, when it is one. The key holds nothing for a direct thread.
          void qc.invalidateQueries({ queryKey: chatKeys.group(slug, id) });
          // It may mean a request whose text this member was never sent, and no seq comes with it to reveal a gap. In a group
          // it may mean rows already on screen read differently now, such as a member this one blocked or unblocked on
          // another device turning redacted or back, which only reading the loaded pages again can show.
          if (isOpen(slug, id)) {
            const thread = qc.getQueryData(chatKeys.conversation(slug, id)) as Pick<ChatConversationDto, "kind"> | undefined;
            if (thread?.kind === "GROUP") void qc.invalidateQueries({ queryKey: chatKeys.messages(slug, id) });
            else void fillGap(slug, id);
          } else void qc.invalidateQueries({ queryKey: chatKeys.messages(slug, id), refetchType: "none" });
          refreshLists(slug);
          refreshGroupLists(slug);
          refreshBadge(slug);
        }),
        realtime.on("chat:unread", ({ tenantSlug: slug, unread, requests, invites }) => {
          const key = chatKeys.badge(slug);
          const before = qc.getQueryData(key) as ChatBadgeDto | undefined;
          qc.setQueryData(key, (): ChatBadgeDto => ({ unread, requests, invites }));
          // A throttled refetch may have read the counts before this changed them, and would put the old ones back.
          refetchIfFetching(key);
          if (before?.invites !== invites) void qc.invalidateQueries({ queryKey: chatKeys.groupInvites(slug) });
        }),
        realtime.onReconnect(catchUp),
      ];
      return () => {
        stops.forEach((stop) => stop());
        timers.forEach((timer) => clearTimeout(timer));
        timers.clear();
        waiting.clear();
      };
    },
    fillGap,
    send: (slug, id, body, clientKey = newClientKey()) => post(slug, id, { clientKey, conversationId: id, body, status: "sending", createdAt: new Date().toISOString() }),
    retry(slug, id, clientKey) {
      const entry = (qc.getQueryData(chatKeys.outbox(slug, id)) as OutboxEntry[] | undefined)?.find((e) => e.clientKey === clientKey);
      return entry ? post(slug, id, { clientKey, conversationId: id, body: entry.body, status: "sending", createdAt: entry.createdAt }) : Promise.resolve(null);
    },
    discard(slug, id, clientKey) {
      qc.setQueryData(chatKeys.outbox(slug, id), (old: OutboxEntry[] | undefined) => removeFromOutbox(old, clientKey));
    },
  };
}
