import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chatClientKeySchema, type ChatBadgeDto, type ChatConversationDto, type ChatMessageDto, type ChatMessageEvent, type CursorPage } from "@illuminize/shared";
import {
  addToOutbox,
  chatKeys,
  createChatSync,
  highestSeq,
  keepNewestPage,
  markLastMessageRemoved,
  markMessageRemoved,
  markOutboxFailed,
  newClientKey,
  removeFromOutbox,
  threadItems,
  upsertLiveMessage,
  type ChatMessagePages,
  type ChatSyncApi,
  type OutboxEntry,
} from "@illuminize/shared/chat";
import { ApiClientError } from "@illuminize/shared/client";
import { InfiniteQueryObserver, QueryClient, QueryObserver } from "@tanstack/query-core";
import { afterEach, describe, expect, it, vi } from "vitest";

const CONVERSATION = "c1";
const SLUG = "demo";
const ME = "m-me";
const THEM = "m-them";

function message(seq: number, overrides: Partial<ChatMessageDto> = {}): ChatMessageDto {
  return {
    id: `id-${seq}`,
    conversationId: CONVERSATION,
    seq,
    kind: "TEXT",
    sender: { id: THEM, fullName: "Them", avatarUrl: null },
    body: `Message ${seq}`,
    removed: false,
    redacted: false,
    meta: null,
    clientKey: null,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString(),
    ...overrides,
  };
}

/** Rows per page, newest first, as the API pages them. */
function pages(rows: number[][], lastHasMore = false): ChatMessagePages {
  return {
    pages: rows.map((seqs, i) => ({ data: seqs.map((seq) => message(seq)), nextCursor: i < rows.length - 1 || lastHasMore ? `cursor-${i}` : null })),
    pageParams: rows.map((_, i) => (i === 0 ? undefined : `cursor-${i - 1}`)),
  };
}
const seqs = (data: ChatMessagePages | undefined) => data?.pages.map((p) => p.data.map((m) => m.seq));

describe("upsertLiveMessage", () => {
  it("never seeds a partial list", () => {
    expect(upsertLiveMessage(undefined, message(1))).toBeUndefined();
    const empty: ChatMessagePages = { pages: [], pageParams: [] };
    expect(upsertLiveMessage(empty, message(1))).toBe(empty);
  });

  it("puts the newest message at the top of the newest page", () => {
    expect(seqs(upsertLiveMessage(pages([[5, 4], [3, 2]]), message(6)))).toEqual([[6, 5, 4], [3, 2]]);
  });

  it("inserts into an empty thread", () => {
    expect(seqs(upsertLiveMessage(pages([[]]), message(1)))).toEqual([[1]]);
  });

  it("replaces by id wherever it's loaded, without adding a row", () => {
    const edited = message(2, { body: "Replaced" });
    const out = upsertLiveMessage(pages([[5, 4], [3, 2]]), edited)!;
    expect(seqs(out)).toEqual([[5, 4], [3, 2]]);
    expect(out.pages[1]!.data[1]!.body).toBe("Replaced");
  });

  it("is idempotent, because a message can arrive twice", () => {
    const once = upsertLiveMessage(pages([[2, 1]]), message(3));
    expect(upsertLiveMessage(once, message(3))).toEqual(once);
  });

  it("drops a message older than everything loaded while there's more to load", () => {
    const data = pages([[9, 8], [7, 6]], true);
    expect(upsertLiveMessage(data, message(5))).toBe(data);
  });

  it("inserts a message older than everything loaded when that's all there is", () => {
    expect(seqs(upsertLiveMessage(pages([[9, 8], [7, 6]]), message(5)))).toEqual([[9, 8], [7, 6, 5]]);
  });

  it("inserts sorted by seq, wherever that falls", () => {
    expect(seqs(upsertLiveMessage(pages([[9, 7], [6, 4]]), message(8)))).toEqual([[9, 8, 7], [6, 4]]);
    expect(seqs(upsertLiveMessage(pages([[9, 7], [6, 4]]), message(5)))).toEqual([[9, 7], [6, 5, 4]]);
  });

  it("orders by seq even when the clock disagrees", () => {
    const late = message(3, { createdAt: new Date(Date.UTC(2020, 0, 1)).toISOString() });
    expect(seqs(upsertLiveMessage(pages([[5, 4], [2, 1]]), late))).toEqual([[5, 4], [3, 2, 1]]);
  });

  it("leaves nextCursor and pageParams exactly as they were", () => {
    const data = pages([[5, 4], [3, 2]], true);
    const out = upsertLiveMessage(data, message(6))!;
    expect(out.pages.map((p) => p.nextCursor)).toEqual(data.pages.map((p) => p.nextCursor));
    expect(out.pageParams).toBe(data.pageParams);
  });

  it("doesn't change what it was given, and keeps untouched pages", () => {
    const data = pages([[5, 4], [3, 2]]);
    const copy = structuredClone(data);
    const out = upsertLiveMessage(data, message(6))!;
    expect(data).toEqual(copy);
    expect(out.pages[1]).toBe(data.pages[1]);
  });

  it("won't let a copy read before a removal bring the words back, and takes a removal over a live copy", () => {
    const removed = markMessageRemoved(pages([[2, 1]]), "id-1")!;
    expect(upsertLiveMessage(removed, message(1))).toBe(removed);
    expect(upsertLiveMessage(pages([[2, 1]]), message(1, { body: null, removed: true }))!.pages[0]!.data[1]).toMatchObject({ body: null, removed: true });
  });
});

describe("markLastMessageRemoved", () => {
  const conversation = { id: CONVERSATION, lastMessage: { seq: 5, body: "The words", mine: false, createdAt: "2026-01-01T00:00:00.000Z" } } as ChatConversationDto;

  it("clears the preview when it's of the removed message", () => {
    expect(markLastMessageRemoved(conversation, 5)!.lastMessage).toEqual({ ...conversation.lastMessage, body: null });
  });

  it("leaves a preview of any other message, and what isn't there", () => {
    expect(markLastMessageRemoved(conversation, 4)).toBe(conversation);
    const empty = { id: CONVERSATION, lastMessage: null } as ChatConversationDto;
    expect(markLastMessageRemoved(empty, 5)).toBe(empty);
    expect(markLastMessageRemoved(undefined, 5)).toBeUndefined();
  });
});

describe("markMessageRemoved", () => {
  it("turns a loaded message into a tombstone", () => {
    const out = markMessageRemoved(pages([[3, 2]]), "id-2")!;
    expect(out.pages[0]!.data[1]).toMatchObject({ id: "id-2", body: null, removed: true });
    expect(out.pages[0]!.data[0]!.body).toBe("Message 3");
  });

  it("does nothing for what isn't loaded", () => {
    const data = pages([[3, 2]]);
    expect(markMessageRemoved(data, "id-9")).toBe(data);
    expect(markMessageRemoved(undefined, "id-9")).toBeUndefined();
  });
});

describe("keepNewestPage", () => {
  it("trims to the first page with its params", () => {
    const out = keepNewestPage(pages([[5, 4], [3, 2]]))!;
    expect(seqs(out)).toEqual([[5, 4]]);
    expect(out.pageParams).toEqual([undefined]);
  });

  it("leaves one page or none alone", () => {
    const one = pages([[5, 4]]);
    expect(keepNewestPage(one)).toBe(one);
    expect(keepNewestPage(undefined)).toBeUndefined();
  });
});

describe("highestSeq", () => {
  it("looks through every page", () => {
    expect(highestSeq(pages([[5, 4], [3, 2]]))).toBe(5);
    expect(highestSeq(pages([[], [3, 2]]))).toBe(3);
    expect(highestSeq(pages([[]]))).toBeNull();
    expect(highestSeq(undefined)).toBeNull();
  });
});

const entry = (clientKey: string, overrides: Partial<OutboxEntry> = {}): OutboxEntry => ({ clientKey, conversationId: CONVERSATION, body: `Pending ${clientKey}`, status: "sending", createdAt: "2026-01-02T00:00:00.000Z", ...overrides });

describe("the outbox", () => {
  it("adds, replaces by key and removes", () => {
    const one = addToOutbox(undefined, entry("k1"));
    expect(one.map((e) => e.clientKey)).toEqual(["k1"]);
    expect(addToOutbox(one, entry("k1", { body: "Changed" }))).toEqual([entry("k1", { body: "Changed" })]);
    const two = addToOutbox(one, entry("k2"));
    expect(two.map((e) => e.clientKey)).toEqual(["k1", "k2"]);
    expect(removeFromOutbox(two, "k1").map((e) => e.clientKey)).toEqual(["k2"]);
    expect(removeFromOutbox(two, "missing")).toBe(two);
    expect(removeFromOutbox(two, null)).toBe(two);
    expect(removeFromOutbox(undefined, "k1")).toEqual([]);
  });

  it("marks one as failed, with the reason and whether a retry can work", () => {
    expect(markOutboxFailed([entry("k1"), entry("k2")], "k1", "Offline", true)[0]).toMatchObject({ status: "failed", error: "Offline", retryable: true });
    expect(markOutboxFailed([entry("k1")], "k1", "Slow down", true, "RATE_LIMITED")[0]).toMatchObject({ code: "RATE_LIMITED" });
  });
});

describe("threadItems", () => {
  it("runs oldest first, with what's unconfirmed last", () => {
    const items = threadItems(pages([[5, 4], [3]]), [entry("k1")]);
    expect(items.map((i) => i.message?.seq ?? i.pending?.clientKey)).toEqual([3, 4, 5, "k1"]);
  });

  it("keys a row on its client key so a bubble keeps its identity when confirmed", () => {
    const before = threadItems(pages([[1]]), [entry("k1")]);
    const data = upsertLiveMessage(pages([[1]]), message(2, { clientKey: "k1", sender: { id: ME, fullName: "Me", avatarUrl: null } }));
    const after = threadItems(data, [entry("k1")]);
    expect(before.at(-1)!.key).toBe("k1");
    expect(after.at(-1)!.key).toBe("k1");
    expect(threadItems(pages([[1]]), []).at(-1)!.key).toBe("id-1");
  });

  it("shows one bubble whichever of the outbox and the pages knows about it first", () => {
    const delivered = upsertLiveMessage(pages([[1]]), message(2, { clientKey: "k1" }));
    // The message landed and the outbox still has it.
    expect(threadItems(delivered, [entry("k1")])).toHaveLength(2);
    // The outbox emptied and the message hasn't landed yet.
    expect(threadItems(pages([[1]]), [])).toHaveLength(1);
    // Neither: it's only in the outbox.
    expect(threadItems(pages([[1]]), [entry("k1")])).toHaveLength(2);
  });

  it("copes with nothing loaded", () => {
    expect(threadItems(undefined, undefined)).toEqual([]);
    expect(threadItems(undefined, [entry("k1")]).map((i) => i.key)).toEqual(["k1"]);
  });
});

describe("newClientKey", () => {
  it("passes the API's rule and doesn't repeat", () => {
    const keys = Array.from({ length: 500 }, newClientKey);
    for (const key of keys) expect(chatClientKeySchema.safeParse(key).success, key).toBe(true);
    expect(new Set(keys).size).toBe(500);
  });

  it("works without crypto, which Hermes doesn't promise", () => {
    vi.stubGlobal("crypto", undefined);
    try {
      expect(chatClientKeySchema.safeParse(newClientKey()).success).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("the shared chat code", () => {
  it("depends on neither React nor a TanStack package", () => {
    const dir = resolve(fileURLToPath(import.meta.url), "../../../../../packages/shared/src/chat");
    for (const file of readdirSync(dir)) {
      const source = readFileSync(resolve(dir, file), "utf8");
      const imports = [...source.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
      expect(imports.filter((i) => !i!.startsWith(".")), file).toEqual([]);
    }
  });
});

describe("createChatSync", () => {
  type Handler = (payload: never) => void;

  /** The socket, with the test deciding what it hears. */
  function fakeRealtime() {
    const handlers = new Map<string, Set<Handler>>();
    const reconnects = new Set<() => void>();
    return {
      on(event: string, handler: Handler) {
        const set = handlers.get(event) ?? new Set<Handler>();
        set.add(handler);
        handlers.set(event, set);
        return () => void set.delete(handler);
      },
      onReconnect(listener: () => void) {
        reconnects.add(listener);
        return () => void reconnects.delete(listener);
      },
      fire(event: string, payload: unknown) {
        handlers.get(event)?.forEach((h) => h(payload as never));
      },
      reconnect() {
        reconnects.forEach((l) => l());
      },
      listeners: () => [...handlers.values()].reduce((n, s) => n + s.size, 0) + reconnects.size,
    };
  }

  function setup(opts: { active?: { slug: string; conversationId: string | null } | null; api?: Partial<ChatSyncApi> } = {}) {
    const qc = new QueryClient();
    const realtime = fakeRealtime();
    const api = {
      messages: vi.fn<ChatSyncApi["messages"]>(async () => ({ data: [], nextCursor: null })),
      send: vi.fn<ChatSyncApi["send"]>(async (_s, _i, input) => message(100, { body: input.body, clientKey: input.clientKey })),
      ...opts.api,
    } as { messages: ReturnType<typeof vi.fn<ChatSyncApi["messages"]>>; send: ReturnType<typeof vi.fn<ChatSyncApi["send"]>> };
    const active = "active" in opts ? opts.active : { slug: SLUG, conversationId: CONVERSATION };
    const state = { active };
    const sync = createChatSync({ realtime: realtime as never, api, queryClient: qc, getActive: () => state.active ?? null });
    const stop = sync.attach();
    const key = chatKeys.messages(SLUG, CONVERSATION);
    return {
      qc,
      realtime,
      api,
      sync,
      stop,
      key,
      state,
      load: (data: ChatMessagePages) => qc.setQueryData(key, data),
      data: () => qc.getQueryData<ChatMessagePages>(key),
      outbox: () => qc.getQueryData<OutboxEntry[]>(chatKeys.outbox(SLUG, CONVERSATION)),
      live: (m: ChatMessageDto) => realtime.fire("chat:message", { tenantSlug: SLUG, conversationId: CONVERSATION, message: m } satisfies ChatMessageEvent),
      invalidated: (k: readonly unknown[]) => qc.getQueryState(k)?.isInvalidated,
    };
  }
  const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("a live message", () => {
    it("patches the thread it belongs to", () => {
      const s = setup();
      s.load(pages([[2, 1]]));
      s.live(message(3));
      expect(seqs(s.data())).toEqual([[3, 2, 1]]);
    });

    it("goes to the right institution's thread", () => {
      const s = setup();
      s.load(pages([[1]]));
      s.realtime.fire("chat:message", { tenantSlug: "other", conversationId: CONVERSATION, message: message(2) });
      expect(seqs(s.data())).toEqual([[1]]);
      expect(s.qc.getQueryData(chatKeys.messages("other", CONVERSATION))).toBeUndefined();
    });

    it("doesn't seed a thread nobody has loaded, and leaves it to fetch when opened", () => {
      const s = setup();
      s.live(message(1));
      expect(s.data()).toBeUndefined();
    });

    it("refreshes the lists and the badge", () => {
      const s = setup();
      s.qc.setQueryData(chatKeys.list(SLUG, "MAIN"), { pages: [], pageParams: [] });
      s.qc.setQueryData(chatKeys.badge(SLUG), { unread: 0, requests: 0, invites: 0 });
      s.load(pages([[1]]));
      s.live(message(2));
      expect(s.invalidated(chatKeys.list(SLUG, "MAIN"))).toBe(true);
      expect(s.invalidated(chatKeys.badge(SLUG))).toBe(true);
    });

    it("invalidates when a fetch is in flight, because the fetch would overwrite the patch", async () => {
      const s = setup();
      s.load(pages([[1]]));
      const responses: Array<(page: CursorPage<ChatMessageDto>) => void> = [];
      const observer = new InfiniteQueryObserver(s.qc, {
        queryKey: s.key,
        initialPageParam: undefined as string | undefined,
        getNextPageParam: (last: CursorPage<ChatMessageDto>) => last.nextCursor ?? undefined,
        queryFn: () => new Promise<CursorPage<ChatMessageDto>>((resolve) => responses.push(resolve)),
      });
      const unsubscribe = observer.subscribe(() => undefined);
      await vi.waitFor(() => expect(responses.length).toBe(1));
      expect(s.qc.getQueryState(s.key)?.fetchStatus).toBe("fetching");

      // Captured before the message existed.
      const stale = { data: [message(1)], nextCursor: null };
      s.live(message(2));
      // The in-flight fetch is cancelled and a fresh one starts.
      await vi.waitFor(() => expect(responses.length).toBe(2));
      responses[0]!(stale);
      responses[1]!({ data: [message(2), message(1)], nextCursor: null });
      await vi.waitFor(() => expect(s.qc.getQueryState(s.key)?.fetchStatus).toBe("idle"));
      expect(seqs(s.data())).toEqual([[2, 1]]);
      unsubscribe();
    });
  });

  describe("a seq gap", () => {
    it("fetches the hole for the open thread and merges it", async () => {
      const s = setup({ api: { messages: vi.fn(async () => ({ data: [message(3), message(4)], nextCursor: null })) } });
      s.load(pages([[2, 1]]));
      s.live(message(5));
      await flush();
      expect(s.api.messages).toHaveBeenCalledWith(SLUG, CONVERSATION, { afterSeq: "2", limit: 50 });
      await vi.waitFor(() => expect(seqs(s.data())).toEqual([[5, 4, 3, 2, 1]]));
    });

    it("doesn't fetch without a gap", async () => {
      const s = setup();
      s.load(pages([[2, 1]]));
      s.live(message(3));
      s.live(message(3));
      await flush();
      expect(s.api.messages).not.toHaveBeenCalled();
    });

    it("tolerates an empty fill, because withheld rows leave gaps forever, and doesn't keep asking", async () => {
      const s = setup();
      s.load(pages([[2, 1]]));
      s.live(message(6));
      await flush();
      expect(s.api.messages).toHaveBeenCalledTimes(1);
      expect(seqs(s.data())).toEqual([[6, 2, 1]]);
      // The hole stays, and the next message in sequence isn't a new gap.
      s.live(message(7));
      await flush();
      expect(s.api.messages).toHaveBeenCalledTimes(1);
      expect(seqs(s.data())).toEqual([[7, 6, 2, 1]]);
    });

    it("marks a thread that isn't open stale rather than fetching for it", async () => {
      const s = setup({ active: { slug: SLUG, conversationId: "another" } });
      s.load(pages([[2, 1]]));
      s.live(message(5));
      await flush();
      expect(s.api.messages).not.toHaveBeenCalled();
      expect(s.invalidated(s.key)).toBe(true);
    });

    it("starts again from the newest page when there's too much to stitch on", async () => {
      const s = setup({ api: { messages: vi.fn(async () => ({ data: [message(3)], nextCursor: "more" })) } });
      s.load(pages([[10, 9], [8, 7]]));
      await s.sync.fillGap(SLUG, CONVERSATION);
      expect(seqs(s.data())).toEqual([[10, 9]]);
      expect(s.invalidated(s.key)).toBe(true);
    });

    it("falls back to a refetch when the fill fails", async () => {
      const s = setup({ api: { messages: vi.fn(async () => Promise.reject(new ApiClientError(0, "NETWORK_ERROR", "offline"))) } });
      s.load(pages([[2, 1]]));
      await expect(s.sync.fillGap(SLUG, CONVERSATION)).resolves.toBeUndefined();
      expect(s.invalidated(s.key)).toBe(true);
    });

    it("runs again once when more gaps turn up during a fill, from the earliest of them", async () => {
      let answer!: (page: CursorPage<ChatMessageDto>) => void;
      const messages = vi.fn<ChatSyncApi["messages"]>().mockImplementationOnce(() => new Promise((resolve) => (answer = resolve))).mockResolvedValue({ data: [], nextCursor: null });
      const s = setup({ api: { messages } });
      s.load(pages([[2, 1]]));
      const first = s.sync.fillGap(SLUG, CONVERSATION);
      void s.sync.fillGap(SLUG, CONVERSATION);
      void s.sync.fillGap(SLUG, CONVERSATION);
      expect(messages).toHaveBeenCalledTimes(1);
      answer({ data: [message(3)], nextCursor: null });
      await first;
      expect(messages).toHaveBeenCalledTimes(2);
      expect(messages).toHaveBeenLastCalledWith(SLUG, CONVERSATION, { afterSeq: "2", limit: 50 });
    });

    it("fills a gap that a send's own response reveals", async () => {
      const s = setup({ api: { send: vi.fn(async () => message(5, { clientKey: "client-key-1" })), messages: vi.fn(async () => ({ data: [message(3), message(4)], nextCursor: null })) } });
      s.load(pages([[2, 1]]));
      await s.sync.send(SLUG, CONVERSATION, "Hello", "client-key-1");
      expect(s.api.messages).toHaveBeenCalledWith(SLUG, CONVERSATION, { afterSeq: "2", limit: 50 });
      await vi.waitFor(() => expect(seqs(s.data())).toEqual([[5, 4, 3, 2, 1]]));
    });

    it("has nothing to fill for a thread with nothing held", async () => {
      const s = setup();
      await s.sync.fillGap(SLUG, CONVERSATION);
      expect(s.api.messages).not.toHaveBeenCalled();
    });
  });

  describe("reconnecting", () => {
    it("refetches the badge and the first list page, then fills the open thread, then again after 3 seconds", async () => {
      vi.useFakeTimers();
      const s = setup();
      s.load(pages([[2, 1]]));
      s.qc.setQueryData(chatKeys.badge(SLUG), { unread: 0, requests: 0, invites: 0 });
      s.qc.setQueryData(chatKeys.list(SLUG, "MAIN"), { pages: [{ data: ["newest"], nextCursor: "c" }, { data: ["older"], nextCursor: null }], pageParams: [undefined, "c"] });
      s.qc.setQueryData(chatKeys.conversation(SLUG, CONVERSATION), { id: CONVERSATION });

      s.realtime.reconnect();
      await vi.advanceTimersByTimeAsync(0);
      expect(s.api.messages).toHaveBeenCalledTimes(1);
      expect(s.api.messages).toHaveBeenCalledWith(SLUG, CONVERSATION, { afterSeq: "2", limit: 50 });
      expect(s.invalidated(chatKeys.badge(SLUG))).toBe(true);
      expect(s.invalidated(chatKeys.list(SLUG, "MAIN"))).toBe(true);
      expect(s.invalidated(chatKeys.conversation(SLUG, CONVERSATION))).toBe(true);
      expect((s.qc.getQueryData(chatKeys.list(SLUG, "MAIN")) as { pages: unknown[] }).pages).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(2999);
      expect(s.api.messages).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(s.api.messages).toHaveBeenCalledTimes(2);
    });

    it("merges what the fill finds, including an event that arrived while it was away", async () => {
      vi.useFakeTimers();
      const s = setup({ api: { messages: vi.fn(async () => ({ data: [message(3), message(4)], nextCursor: null })) } });
      s.load(pages([[2, 1]]));
      s.realtime.reconnect();
      await vi.advanceTimersByTimeAsync(0);
      expect(seqs(s.data())).toEqual([[4, 3, 2, 1]]);
      // The second fill sees nothing new and is fine with that.
      s.api.messages.mockResolvedValue({ data: [], nextCursor: null });
      await vi.advanceTimersByTimeAsync(3000);
      expect(s.api.messages).toHaveBeenLastCalledWith(SLUG, CONVERSATION, { afterSeq: "4", limit: 50 });
      expect(seqs(s.data())).toEqual([[4, 3, 2, 1]]);
    });

    it("skips the second fill if the member has left the thread", async () => {
      vi.useFakeTimers();
      const s = setup();
      s.load(pages([[2, 1]]));
      s.realtime.reconnect();
      await vi.advanceTimersByTimeAsync(0);
      s.state.active = { slug: SLUG, conversationId: null };
      await vi.advanceTimersByTimeAsync(3000);
      expect(s.api.messages).toHaveBeenCalledTimes(1);
    });

    it("reads the open thread's pages again, because a removal missed while away is of a message already held", async () => {
      const s = setup();
      s.load(pages([[2, 1]]));
      const fetched = vi.fn(async () => ({ data: [message(2), message(1, { body: null, removed: true })], nextCursor: null }));
      const observer = new InfiniteQueryObserver(s.qc, {
        queryKey: s.key,
        initialPageParam: undefined as string | undefined,
        getNextPageParam: (last: CursorPage<ChatMessageDto>) => last.nextCursor ?? undefined,
        queryFn: fetched,
        staleTime: Infinity,
      });
      const unsubscribe = observer.subscribe(() => undefined);
      expect(fetched).not.toHaveBeenCalled();

      s.realtime.reconnect();
      await vi.waitFor(() => expect(s.data()!.pages[0]!.data[1]).toMatchObject({ body: null, removed: true }));
      expect(fetched).toHaveBeenCalled();
      unsubscribe();
    });

    it("only touches lists when no thread is open, and nothing when no institution is", async () => {
      const onLists = setup({ active: { slug: SLUG, conversationId: null } });
      onLists.load(pages([[1]]));
      onLists.realtime.reconnect();
      await flush();
      expect(onLists.api.messages).not.toHaveBeenCalled();

      const nowhere = setup({ active: null });
      nowhere.load(pages([[1]]));
      nowhere.realtime.reconnect();
      await flush();
      expect(nowhere.api.messages).not.toHaveBeenCalled();
      expect(nowhere.invalidated(nowhere.key)).toBeFalsy();
    });

    it("stops listening and cancels a pending fill when detached", async () => {
      vi.useFakeTimers();
      const s = setup();
      s.load(pages([[2, 1]]));
      expect(s.realtime.listeners()).toBeGreaterThan(0);
      s.realtime.reconnect();
      await vi.advanceTimersByTimeAsync(0);
      s.stop();
      expect(s.realtime.listeners()).toBe(0);
      await vi.advanceTimersByTimeAsync(5000);
      expect(s.api.messages).toHaveBeenCalledTimes(1);
    });
  });

  describe("other events", () => {
    it("chat:removed makes a tombstone", () => {
      const s = setup();
      s.load(pages([[2, 1]]));
      s.realtime.fire("chat:removed", { tenantSlug: SLUG, conversationId: CONVERSATION, messageId: "id-1", seq: 1 });
      expect(s.data()!.pages[0]!.data[1]).toMatchObject({ body: null, removed: true });
    });

    it("chat:removed refetches when a fetch is in flight, because the fetch would bring the removed body back", async () => {
      const s = setup();
      s.load(pages([[2, 1]]));
      const responses: Array<(page: CursorPage<ChatMessageDto>) => void> = [];
      const observer = new InfiniteQueryObserver(s.qc, {
        queryKey: s.key,
        initialPageParam: undefined as string | undefined,
        getNextPageParam: (last: CursorPage<ChatMessageDto>) => last.nextCursor ?? undefined,
        queryFn: () => new Promise<CursorPage<ChatMessageDto>>((resolve) => responses.push(resolve)),
      });
      const unsubscribe = observer.subscribe(() => undefined);
      await vi.waitFor(() => expect(responses.length).toBe(1));

      // Read before the removal committed, and still on its way.
      const stale = { data: [message(2), message(1)], nextCursor: null };
      s.realtime.fire("chat:removed", { tenantSlug: SLUG, conversationId: CONVERSATION, messageId: "id-1", seq: 1 });
      expect(s.data()!.pages[0]!.data[1]).toMatchObject({ body: null, removed: true });
      await vi.waitFor(() => expect(responses.length).toBe(2));
      responses[0]!(stale);
      responses[1]!({ data: [message(2), message(1, { body: null, removed: true })], nextCursor: null });
      await vi.waitFor(() => expect(s.qc.getQueryState(s.key)?.fetchStatus).toBe("idle"));
      expect(s.data()!.pages[0]!.data[1]).toMatchObject({ body: null, removed: true });
      unsubscribe();
    });

    it("chat:removed doesn't refetch when nothing is in flight", () => {
      const s = setup();
      s.load(pages([[2, 1]]));
      s.realtime.fire("chat:removed", { tenantSlug: SLUG, conversationId: CONVERSATION, messageId: "id-1", seq: 1 });
      expect(s.invalidated(s.key)).toBe(false);
    });

    it("chat:removed takes the words out of the thread's preview at once, leaving a preview of a later message", () => {
      const s = setup();
      const key = chatKeys.conversation(SLUG, CONVERSATION);
      const preview = (seq: number) => ({ id: CONVERSATION, lastMessage: { seq, body: "The words", mine: false, createdAt: "2026-01-01T00:00:00.000Z" } }) as ChatConversationDto;
      s.qc.setQueryData(key, preview(1));
      s.realtime.fire("chat:removed", { tenantSlug: SLUG, conversationId: CONVERSATION, messageId: "id-1", seq: 1 });
      expect(s.qc.getQueryData<ChatConversationDto>(key)!.lastMessage!.body).toBeNull();

      s.qc.setQueryData(key, preview(2));
      s.realtime.fire("chat:removed", { tenantSlug: SLUG, conversationId: CONVERSATION, messageId: "id-1", seq: 1 });
      expect(s.qc.getQueryData<ChatConversationDto>(key)!.lastMessage!.body).toBe("The words");
    });

    it("chat:removed refetches the thread's preview when a fetch is in flight, because the fetch would bring the words back", async () => {
      const s = setup();
      const key = chatKeys.conversation(SLUG, CONVERSATION);
      const preview = (body: string | null) => ({ id: CONVERSATION, lastMessage: { seq: 1, body, mine: false, createdAt: "2026-01-01T00:00:00.000Z" } }) as ChatConversationDto;
      s.qc.setQueryData(key, preview("The words"));
      const responses: Array<(dto: ChatConversationDto) => void> = [];
      const observer = new QueryObserver(s.qc, { queryKey: key, queryFn: () => new Promise<ChatConversationDto>((resolve) => responses.push(resolve)) });
      const unsubscribe = observer.subscribe(() => undefined);
      await vi.waitFor(() => expect(responses.length).toBe(1));

      s.realtime.fire("chat:removed", { tenantSlug: SLUG, conversationId: CONVERSATION, messageId: "id-1", seq: 1 });
      await vi.waitFor(() => expect(responses.length).toBe(2));
      responses[0]!(preview("The words"));
      responses[1]!(preview(null));
      await vi.waitFor(() => expect(s.qc.getQueryState(key)?.fetchStatus).toBe("idle"));
      expect(s.qc.getQueryData<ChatConversationDto>(key)!.lastMessage!.body).toBeNull();
      unsubscribe();
    });

    it("a gap fill read before a removal and landing after it can't bring the words back, even for a message that wasn't loaded", async () => {
      let answer!: (page: CursorPage<ChatMessageDto>) => void;
      const s = setup({ api: { messages: vi.fn(() => new Promise<CursorPage<ChatMessageDto>>((resolve) => (answer = resolve))) } });
      s.load(pages([[2, 1]]));
      const filling = s.sync.fillGap(SLUG, CONVERSATION);
      s.realtime.fire("chat:removed", { tenantSlug: SLUG, conversationId: CONVERSATION, messageId: "id-3", seq: 3 });
      answer({ data: [message(3)], nextCursor: null });
      await filling;
      expect(s.data()!.pages[0]!.data[0]).toMatchObject({ id: "id-3", body: null, removed: true });
    });

    it("a live copy arriving after its removal doesn't bring the words back either", () => {
      const s = setup();
      s.load(pages([[2]]));
      s.realtime.fire("chat:removed", { tenantSlug: SLUG, conversationId: CONVERSATION, messageId: "id-3", seq: 3 });
      s.live(message(3));
      expect(s.data()!.pages[0]!.data[0]).toMatchObject({ id: "id-3", body: null, removed: true });
    });

    it("chat:read refetches when a fetch of the thread is in flight, because the fetch would undo it", async () => {
      const s = setup();
      const key = chatKeys.conversation(SLUG, CONVERSATION);
      s.qc.setQueryData(key, { id: CONVERSATION, unread: 3, lastReadSeq: 2 } as ChatConversationDto);
      const responses: Array<(dto: ChatConversationDto) => void> = [];
      const observer = new QueryObserver(s.qc, { queryKey: key, queryFn: () => new Promise<ChatConversationDto>((resolve) => responses.push(resolve)) });
      const unsubscribe = observer.subscribe(() => undefined);
      await vi.waitFor(() => expect(responses.length).toBe(1));

      s.realtime.fire("chat:read", { tenantSlug: SLUG, conversationId: CONVERSATION, membershipId: ME, lastReadSeq: 5 });
      expect(s.qc.getQueryData(key)).toMatchObject({ unread: 0, lastReadSeq: 5 });
      await vi.waitFor(() => expect(responses.length).toBe(2));
      responses[0]!({ id: CONVERSATION, unread: 3, lastReadSeq: 2 } as ChatConversationDto);
      responses[1]!({ id: CONVERSATION, unread: 0, lastReadSeq: 5 } as ChatConversationDto);
      await vi.waitFor(() => expect(s.qc.getQueryState(key)?.fetchStatus).toBe("idle"));
      expect(s.qc.getQueryData(key)).toMatchObject({ unread: 0, lastReadSeq: 5 });
      unsubscribe();
    });

    it("chat:changed brings in a request's text for a thread on screen, which no other event carries", async () => {
      const s = setup({ api: { messages: vi.fn(async () => ({ data: [message(2)], nextCursor: null })) } });
      s.load(pages([[1]]));
      s.realtime.fire("chat:changed", { tenantSlug: SLUG, conversationId: CONVERSATION });
      await vi.waitFor(() => expect(seqs(s.data())).toEqual([[2, 1]]));
      expect(s.api.messages).toHaveBeenCalledWith(SLUG, CONVERSATION, { afterSeq: "1", limit: 50 });
    });

    it("chat:changed fills a thread loaded empty from the start", async () => {
      const s = setup({ api: { messages: vi.fn(async () => ({ data: [message(1)], nextCursor: null })) } });
      s.load(pages([[]]));
      s.realtime.fire("chat:changed", { tenantSlug: SLUG, conversationId: CONVERSATION });
      await vi.waitFor(() => expect(seqs(s.data())).toEqual([[1]]));
      expect(s.api.messages).toHaveBeenCalledWith(SLUG, CONVERSATION, { afterSeq: "0", limit: 50 });
    });

    it("chat:changed reads an open group thread's loaded pages again, since rows already shown may read differently now", async () => {
      const s = setup();
      s.load(pages([[2, 1]]));
      s.qc.setQueryData(chatKeys.conversation(SLUG, CONVERSATION), { id: CONVERSATION, kind: "GROUP" } as ChatConversationDto);
      s.realtime.fire("chat:changed", { tenantSlug: SLUG, conversationId: CONVERSATION });
      await flush();
      expect(s.invalidated(s.key)).toBe(true);
      // Not a gap fill, which would only add rows after the last one and never revisit those on screen.
      expect(s.api.messages).not.toHaveBeenCalled();
    });

    it("chat:changed marks a loaded thread stale when it isn't on screen, and fetches nothing yet", async () => {
      const s = setup({ active: { slug: SLUG, conversationId: "another" } });
      s.load(pages([[1]]));
      s.realtime.fire("chat:changed", { tenantSlug: SLUG, conversationId: CONVERSATION });
      await flush();
      expect(s.api.messages).not.toHaveBeenCalled();
      expect(s.invalidated(s.key)).toBe(true);
    });

    it("chat:unread sets the badge directly", () => {
      const s = setup();
      s.realtime.fire("chat:unread", { tenantSlug: SLUG, membershipId: ME, unread: 3, requests: 1, invites: 2 });
      expect(s.qc.getQueryData<ChatBadgeDto>(chatKeys.badge(SLUG))).toEqual({ unread: 3, requests: 1, invites: 2 });
      expect(s.invalidated(chatKeys.badge(SLUG))).toBe(false);
    });

    it("chat:unread refetches when a badge fetch is in flight, because it read the counts before they changed", async () => {
      const s = setup();
      const key = chatKeys.badge(SLUG);
      s.qc.setQueryData(key, { unread: 1, requests: 0, invites: 0 });
      const responses: Array<(dto: ChatBadgeDto) => void> = [];
      const observer = new QueryObserver(s.qc, { queryKey: key, queryFn: () => new Promise<ChatBadgeDto>((resolve) => responses.push(resolve)) });
      const unsubscribe = observer.subscribe(() => undefined);
      await vi.waitFor(() => expect(responses.length).toBe(1));

      s.realtime.fire("chat:unread", { tenantSlug: SLUG, membershipId: ME, unread: 0, requests: 0, invites: 0 });
      expect(s.qc.getQueryData(key)).toEqual({ unread: 0, requests: 0, invites: 0 });
      await vi.waitFor(() => expect(responses.length).toBe(2));
      responses[0]!({ unread: 1, requests: 0, invites: 0 });
      responses[1]!({ unread: 0, requests: 0, invites: 0 });
      await vi.waitFor(() => expect(s.qc.getQueryState(key)?.fetchStatus).toBe("idle"));
      expect(s.qc.getQueryData(key)).toEqual({ unread: 0, requests: 0, invites: 0 });
      unsubscribe();
    });

    it("chat:changed refetches the thread, the lists and the badge, and carries nothing to patch", () => {
      const s = setup();
      s.qc.setQueryData(chatKeys.conversation(SLUG, CONVERSATION), { id: CONVERSATION });
      s.qc.setQueryData(chatKeys.list(SLUG, "REQUESTS"), { pages: [], pageParams: [] });
      s.qc.setQueryData(chatKeys.badge(SLUG), { unread: 0, requests: 0, invites: 0 });
      s.realtime.fire("chat:changed", { tenantSlug: SLUG, conversationId: CONVERSATION });
      expect(s.invalidated(chatKeys.conversation(SLUG, CONVERSATION))).toBe(true);
      expect(s.invalidated(chatKeys.list(SLUG, "REQUESTS"))).toBe(true);
      expect(s.invalidated(chatKeys.badge(SLUG))).toBe(true);
    });

    it("chat:changed about a group refetches its details, its members and the Groups lists too, and no other group", () => {
      const s = setup();
      const other = "c2";
      for (const key of [chatKeys.group(SLUG, CONVERSATION), chatKeys.groupMembers(SLUG, CONVERSATION), chatKeys.group(SLUG, other), chatKeys.groupList(SLUG, "DISCOVER"), chatKeys.groupInvites(SLUG)]) s.qc.setQueryData(key, {});
      s.realtime.fire("chat:changed", { tenantSlug: SLUG, conversationId: CONVERSATION });
      expect(s.invalidated(chatKeys.group(SLUG, CONVERSATION))).toBe(true);
      expect(s.invalidated(chatKeys.groupMembers(SLUG, CONVERSATION))).toBe(true);
      expect(s.invalidated(chatKeys.groupList(SLUG, "DISCOVER"))).toBe(true);
      expect(s.invalidated(chatKeys.groupInvites(SLUG))).toBe(true);
      expect(s.invalidated(chatKeys.group(SLUG, other))).toBe(false);
    });

    it("chat:unread refetches Invitations when the number waiting changed, and only then", () => {
      const s = setup();
      s.qc.setQueryData(chatKeys.badge(SLUG), { unread: 0, requests: 0, invites: 1 });
      s.qc.setQueryData(chatKeys.groupInvites(SLUG), {});
      s.realtime.fire("chat:unread", { tenantSlug: SLUG, membershipId: ME, unread: 2, requests: 0, invites: 1 });
      expect(s.invalidated(chatKeys.groupInvites(SLUG))).toBe(false);
      s.realtime.fire("chat:unread", { tenantSlug: SLUG, membershipId: ME, unread: 2, requests: 0, invites: 2 });
      expect(s.invalidated(chatKeys.groupInvites(SLUG))).toBe(true);
    });

    it("a reconnect refetches the Groups lists, which may have missed an invitation", () => {
      const s = setup();
      s.qc.setQueryData(chatKeys.groupList(SLUG, "MINE"), {});
      s.realtime.reconnect();
      expect(s.invalidated(chatKeys.groupList(SLUG, "MINE"))).toBe(true);
    });

    it("chat:read moves the read position forward on another device and never back", () => {
      const s = setup();
      const conversation = { id: CONVERSATION, unread: 3, lastReadSeq: 2 } as ChatConversationDto;
      s.qc.setQueryData(chatKeys.conversation(SLUG, CONVERSATION), conversation);
      s.realtime.fire("chat:read", { tenantSlug: SLUG, conversationId: CONVERSATION, membershipId: ME, lastReadSeq: 4 });
      expect(s.qc.getQueryData(chatKeys.conversation(SLUG, CONVERSATION))).toMatchObject({ unread: 1, lastReadSeq: 4 });
      s.realtime.fire("chat:read", { tenantSlug: SLUG, conversationId: CONVERSATION, membershipId: ME, lastReadSeq: 1 });
      expect(s.qc.getQueryData(chatKeys.conversation(SLUG, CONVERSATION))).toMatchObject({ unread: 1, lastReadSeq: 4 });
    });
  });

  describe("throttling", () => {
    it("refetches the badge at once, then no more than every 30 seconds through a burst", async () => {
      vi.useFakeTimers();
      const invalidate = vi.fn();
      const s = setup();
      s.qc.invalidateQueries = invalidate as never;
      const badgeCalls = () => invalidate.mock.calls.filter(([f]) => JSON.stringify(f.queryKey) === JSON.stringify(chatKeys.badge(SLUG))).length;
      s.load(pages([[1]]));
      s.live(message(2));
      expect(badgeCalls()).toBe(1);
      for (let i = 3; i < 13; i++) s.live(message(i));
      expect(badgeCalls()).toBe(1);
      await vi.advanceTimersByTimeAsync(29_999);
      expect(badgeCalls()).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(badgeCalls()).toBe(2);
      // A quiet stretch: the next one goes straight away again.
      await vi.advanceTimersByTimeAsync(31_000);
      s.live(message(20));
      expect(badgeCalls()).toBe(3);
    });
  });

  describe("sending", () => {
    it("shows the message at once and settles it on the response, leaving one row", async () => {
      let answer!: (m: ChatMessageDto) => void;
      const s = setup({ api: { send: vi.fn(() => new Promise<ChatMessageDto>((resolve) => (answer = resolve))) } });
      s.load(pages([[1]]));
      const sending = s.sync.send(SLUG, CONVERSATION, "Hello", "client-key-1");
      expect(s.outbox()).toEqual([expect.objectContaining({ clientKey: "client-key-1", body: "Hello", status: "sending" })]);
      expect(threadItems(s.data(), s.outbox()).map((i) => i.key)).toEqual(["id-1", "client-key-1"]);
      answer(message(2, { body: "Hello", clientKey: "client-key-1" }));
      await sending;
      expect(s.outbox()).toEqual([]);
      expect(threadItems(s.data(), s.outbox()).map((i) => i.key)).toEqual(["id-1", "client-key-1"]);
      expect(seqs(s.data())).toEqual([[2, 1]]);
    });

    it("leaves one row when the socket echo beats the response", async () => {
      let answer!: (m: ChatMessageDto) => void;
      const s = setup({ api: { send: vi.fn(() => new Promise<ChatMessageDto>((resolve) => (answer = resolve))) } });
      s.load(pages([[1]]));
      const delivered = message(2, { body: "Hello", clientKey: "client-key-1" });
      const sending = s.sync.send(SLUG, CONVERSATION, "Hello", "client-key-1");
      s.live(delivered);
      expect(s.outbox()).toEqual([]);
      expect(threadItems(s.data(), s.outbox())).toHaveLength(2);
      answer(delivered);
      await sending;
      expect(threadItems(s.data(), s.outbox())).toHaveLength(2);
      expect(seqs(s.data())).toEqual([[2, 1]]);
    });

    it("leaves one row when the response beats the socket echo", async () => {
      const delivered = message(2, { body: "Hello", clientKey: "client-key-1" });
      const s = setup({ api: { send: vi.fn(async () => delivered) } });
      s.load(pages([[1]]));
      await s.sync.send(SLUG, CONVERSATION, "Hello", "client-key-1");
      s.live(delivered);
      expect(threadItems(s.data(), s.outbox())).toHaveLength(2);
      expect(s.outbox()).toEqual([]);
    });

    it("keeps a failed send visible, and a retry uses the same key and clears it", async () => {
      const send = vi.fn<ChatSyncApi["send"]>().mockRejectedValueOnce(new ApiClientError(0, "NETWORK_ERROR", "You appear to be offline")).mockResolvedValue(message(2, { body: "Hello", clientKey: "client-key-1" }));
      const s = setup({ api: { send } });
      s.load(pages([[1]]));
      expect(await s.sync.send(SLUG, CONVERSATION, "Hello", "client-key-1")).toBeNull();
      expect(s.outbox()).toEqual([expect.objectContaining({ clientKey: "client-key-1", status: "failed", retryable: true, error: "You appear to be offline" })]);
      expect(threadItems(s.data(), s.outbox()).at(-1)).toMatchObject({ pending: { status: "failed" } });

      const retried = await s.sync.retry(SLUG, CONVERSATION, "client-key-1");
      expect(retried).toMatchObject({ seq: 2 });
      expect(send).toHaveBeenLastCalledWith(SLUG, CONVERSATION, { body: "Hello", clientKey: "client-key-1" }, { signal: expect.any(AbortSignal) });
      expect(s.outbox()).toEqual([]);
    });

    it("treats a refusal as final and refreshes what the screen believes", async () => {
      const send = vi.fn<ChatSyncApi["send"]>().mockRejectedValue(new ApiClientError(409, "CHAT_REQUEST_PENDING", "Waiting for an answer"));
      const s = setup({ api: { send } });
      s.load(pages([[1]]));
      s.qc.setQueryData(chatKeys.conversation(SLUG, CONVERSATION), { id: CONVERSATION });
      await s.sync.send(SLUG, CONVERSATION, "Hello", "client-key-1");
      expect(s.outbox()).toEqual([expect.objectContaining({ status: "failed", retryable: false, error: "Waiting for an answer" })]);
      expect(s.invalidated(chatKeys.conversation(SLUG, CONVERSATION))).toBe(true);
      s.sync.discard(SLUG, CONVERSATION, "client-key-1");
      expect(s.outbox()).toEqual([]);
    });

    it("keeps the API's error code on a failed send, so a screen can tell slowing down from a refusal", async () => {
      const send = vi.fn<ChatSyncApi["send"]>().mockRejectedValueOnce(new ApiClientError(429, "RATE_LIMITED", "Too many requests")).mockRejectedValueOnce(new Error("boom"));
      const s = setup({ api: { send } });
      s.load(pages([[1]]));
      await s.sync.send(SLUG, CONVERSATION, "Hello", "client-key-1");
      expect(s.outbox()).toEqual([expect.objectContaining({ status: "failed", retryable: true, code: "RATE_LIMITED" })]);
      // A retry starts clean, and an error that isn't the API's carries no code.
      await s.sync.retry(SLUG, CONVERSATION, "client-key-1");
      expect(s.outbox()![0]).not.toHaveProperty("code");
    });

    it("sends one at a time per thread, in the order they were written, whatever answers first", async () => {
      const answers: Array<() => void> = [];
      const send = vi.fn<ChatSyncApi["send"]>(
        (_s, _i, input) =>
          new Promise<ChatMessageDto>((resolve, reject) => {
            const seq = 1 + answers.length + 1;
            answers.push(() => (input.body === "Fails" ? reject(new ApiClientError(0, "NETWORK_ERROR", "Offline")) : resolve(message(seq, { body: input.body, clientKey: input.clientKey }))));
          }),
      );
      const s = setup({ api: { send } });
      s.load(pages([[1]]));
      const first = s.sync.send(SLUG, CONVERSATION, "Fails", "client-key-1");
      const second = s.sync.send(SLUG, CONVERSATION, "Second", "client-key-2");
      const third = s.sync.send(SLUG, CONVERSATION, "Third", "client-key-3");
      // All three show at once, and only the first has gone.
      expect(s.outbox()!.map((e) => e.body)).toEqual(["Fails", "Second", "Third"]);
      expect(send.mock.calls.map((c) => c[2].body)).toEqual(["Fails"]);
      // A failure still lets the next one go.
      answers[0]!();
      expect(await first).toBeNull();
      await flush();
      expect(send.mock.calls.map((c) => c[2].body)).toEqual(["Fails", "Second"]);
      answers[1]!();
      await second;
      await flush();
      expect(send.mock.calls.map((c) => c[2].body)).toEqual(["Fails", "Second", "Third"]);
      answers[2]!();
      await third;
      expect(s.outbox()).toEqual([expect.objectContaining({ clientKey: "client-key-1", status: "failed" })]);

      // Another thread doesn't wait for this one.
      const other = vi.fn<ChatSyncApi["send"]>(() => new Promise<ChatMessageDto>(() => {}));
      const t = setup({ api: { send: other } });
      void t.sync.send(SLUG, CONVERSATION, "Waiting", "client-key-4");
      void t.sync.send(SLUG, "c2", "Elsewhere", "client-key-5");
      expect(other.mock.calls.map((c) => c[2].body)).toEqual(["Waiting", "Elsewhere"]);
    });

    it("makes up a valid key when not given one, and has nothing to retry for an unknown key", async () => {
      const s = setup();
      s.load(pages([[1]]));
      await s.sync.send(SLUG, CONVERSATION, "Hello");
      expect(chatClientKeySchema.safeParse(s.api.send.mock.calls[0]![2].clientKey).success).toBe(true);
      expect(await s.sync.retry(SLUG, CONVERSATION, "not-a-real-key")).toBeNull();
    });

    it("fails a send that gets no answer in time, so it can be tried again under its key and the ones behind it go", async () => {
      vi.useFakeTimers();
      const signals: Array<AbortSignal | undefined> = [];
      const send = vi
        .fn<ChatSyncApi["send"]>()
        .mockImplementationOnce((_s, _i, _input, options) => {
          signals.push(options?.signal);
          return new Promise<ChatMessageDto>(() => {});
        })
        .mockImplementation(async (_s, _i, input) => message(2, { body: input.body, clientKey: input.clientKey }));
      const s = setup({ api: { send } });
      s.load(pages([[1]]));
      const first = s.sync.send(SLUG, CONVERSATION, "Lost on the way", "client-key-1");
      const second = s.sync.send(SLUG, CONVERSATION, "Behind it", "client-key-2");
      await vi.advanceTimersByTimeAsync(19_999);
      expect(send).toHaveBeenCalledTimes(1);
      expect(s.outbox()!.map((e) => e.status)).toEqual(["sending", "sending"]);

      await vi.advanceTimersByTimeAsync(1);
      expect(await first).toBeNull();
      expect(signals[0]!.aborted).toBe(true);
      expect(s.outbox()).toEqual([expect.objectContaining({ clientKey: "client-key-1", status: "failed", retryable: true, code: "NETWORK_ERROR" })]);
      expect(await second).toMatchObject({ clientKey: "client-key-2" });
      expect(send.mock.calls.map((c) => c[2].body)).toEqual(["Lost on the way", "Behind it"]);

      await s.sync.retry(SLUG, CONVERSATION, "client-key-1");
      expect(send).toHaveBeenLastCalledWith(SLUG, CONVERSATION, { body: "Lost on the way", clientKey: "client-key-1" }, expect.anything());
    });

    it("takes its time limit as an option", async () => {
      vi.useFakeTimers();
      const qc = new QueryClient();
      const send = vi.fn<ChatSyncApi["send"]>(() => new Promise<ChatMessageDto>(() => {}));
      const sync = createChatSync({ realtime: { on: () => () => undefined, onReconnect: () => () => undefined } as never, api: { send, messages: vi.fn() }, queryClient: qc, getActive: () => null, sendTimeoutMs: 5_000 });
      const sending = sync.send(SLUG, CONVERSATION, "Hello", "client-key-1");
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await sending).toBeNull();
    });

    it("reads the thread again after a send that wasn't in an accepted chat, because asking again uses up the one message", async () => {
      const s = setup();
      s.load(pages([[1]]));
      const key = chatKeys.conversation(SLUG, CONVERSATION);
      s.qc.setQueryData(key, { id: CONVERSATION, state: "REQUEST_SENT", canSend: true } as ChatConversationDto);
      await s.sync.send(SLUG, CONVERSATION, "Asking again", "client-key-1");
      expect(s.invalidated(key)).toBe(true);

      s.qc.setQueryData(key, { id: CONVERSATION, state: "CLOSED", canSend: true } as ChatConversationDto);
      await s.sync.send(SLUG, CONVERSATION, "Asking again", "client-key-closed");
      expect(s.invalidated(key)).toBe(true);

      // An accepted chat doesn't change by being written in, so a busy one isn't read again per message.
      s.qc.setQueryData(key, { id: CONVERSATION, state: "ACCEPTED", canSend: true } as ChatConversationDto);
      await s.sync.send(SLUG, CONVERSATION, "Chatting", "client-key-2");
      expect(s.invalidated(key)).toBe(false);
    });

    it("fetches rather than seeds when a send lands in a thread nothing has loaded", async () => {
      const s = setup();
      s.qc.setQueryData(s.key, undefined);
      await s.sync.send(SLUG, CONVERSATION, "Hello", "client-key-1");
      expect(s.data()).toBeUndefined();
    });
  });
});
