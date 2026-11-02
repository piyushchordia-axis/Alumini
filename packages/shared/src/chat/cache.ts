import type { ChatConversationDto, ChatMessageDto, CursorPage } from "../types/dto";

/** A thread's loaded pages, the shape of an infinite query: pages[0] is the newest, and rows run newest first within a page. */
export interface ChatMessagePages {
  pages: Array<CursorPage<ChatMessageDto>>;
  pageParams: unknown[];
}

/** A message the server hasn't confirmed. These live apart from the pages, because any refetch replaces the pages. */
export interface OutboxEntry {
  clientKey: string;
  conversationId: string;
  body: string;
  status: "sending" | "failed";
  /** Why it failed, when it did. */
  error?: string;
  /** Sending it again with the same key can work: the network or the server failed, not the request. */
  retryable?: boolean;
  createdAt: string;
}

export function highestSeq(data: ChatMessagePages | undefined): number | null {
  let highest: number | null = null;
  for (const page of data?.pages ?? []) for (const m of page.data) if (highest === null || m.seq > highest) highest = m.seq;
  return highest;
}

function lowestSeq(pages: ChatMessagePages["pages"]): number | null {
  let lowest: number | null = null;
  for (const page of pages) for (const m of page.data) if (lowest === null || m.seq < lowest) lowest = m.seq;
  return lowest;
}

function withPage<T extends ChatMessagePages>(data: T, index: number, rows: ChatMessageDto[]): T {
  return { ...data, pages: data.pages.map((page, i) => (i === index ? { ...page, data: rows } : page)) };
}

/**
 * Patches one live message into a thread. Replaces it by id if it's loaded, unless that would bring back what a removal took
 * away: nothing restores a removed message, so a copy still saying otherwise was read before the removal. Drops it if it's
 * older than everything loaded while there's more to load, because paging back will bring it. Otherwise inserts it in `seq`
 * order. Nothing loaded means nothing to patch, because a partial list must never be seeded. `nextCursor` and `pageParams`
 * are never touched.
 */
export function upsertLiveMessage<T extends ChatMessagePages>(data: T | undefined, message: ChatMessageDto): T | undefined {
  if (!data || data.pages.length === 0) return data;
  for (let i = 0; i < data.pages.length; i++) {
    const rows = data.pages[i]!.data;
    const at = rows.findIndex((m) => m.id === message.id);
    if (at !== -1) return rows[at]!.removed && !message.removed ? data : withPage(data, i, rows.map((m, j) => (j === at ? message : m)));
  }
  const last = data.pages.length - 1;
  const lowest = lowestSeq(data.pages);
  if (data.pages[last]!.nextCursor && lowest !== null && message.seq < lowest) return data;
  for (let i = 0; i <= last; i++) {
    const rows = data.pages[i]!.data;
    const at = rows.findIndex((m) => m.seq < message.seq);
    if (at !== -1) return withPage(data, i, [...rows.slice(0, at), message, ...rows.slice(at)]);
  }
  return withPage(data, last, [...data.pages[last]!.data, message]);
}

/** Turns a loaded message into the tombstone every member sees. A message that isn't loaded will arrive that way. */
export function markMessageRemoved<T extends ChatMessagePages>(data: T | undefined, messageId: string): T | undefined {
  if (!data) return data;
  for (let i = 0; i < data.pages.length; i++) {
    const rows = data.pages[i]!.data;
    if (rows.some((m) => m.id === messageId)) return withPage(data, i, rows.map((m) => (m.id === messageId ? { ...m, body: null, removed: true } : m)));
  }
  return data;
}

/** Takes the removed message's words out of a thread's preview, if that's what the preview is of. */
export function markLastMessageRemoved(conversation: ChatConversationDto | undefined, seq: number): ChatConversationDto | undefined {
  return conversation?.lastMessage?.seq === seq ? { ...conversation, lastMessage: { ...conversation.lastMessage, body: null } } : conversation;
}

/** Keeps only the newest page, so a refetch after being away asks for one page rather than everything scrolled through. */
export function keepNewestPage<T extends ChatMessagePages | { pages: unknown[]; pageParams: unknown[] }>(data: T | undefined): T | undefined {
  if (!data || data.pages.length <= 1) return data;
  return { ...data, pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) };
}

export function addToOutbox(outbox: OutboxEntry[] | undefined, entry: OutboxEntry): OutboxEntry[] {
  const list = outbox ?? [];
  return list.some((e) => e.clientKey === entry.clientKey) ? list.map((e) => (e.clientKey === entry.clientKey ? entry : e)) : [...list, entry];
}

export function removeFromOutbox(outbox: OutboxEntry[] | undefined, clientKey: string | null | undefined): OutboxEntry[] {
  const list = outbox ?? [];
  if (!clientKey || !list.some((e) => e.clientKey === clientKey)) return list;
  return list.filter((e) => e.clientKey !== clientKey);
}

export function markOutboxFailed(outbox: OutboxEntry[] | undefined, clientKey: string, error: string, retryable: boolean): OutboxEntry[] {
  return (outbox ?? []).map((e) => (e.clientKey === clientKey ? { ...e, status: "failed" as const, error, retryable } : e));
}

/** A row of a thread, keyed so a bubble keeps its identity when its send is confirmed. */
export type ThreadItem = { key: string; message: ChatMessageDto; pending: null } | { key: string; message: null; pending: OutboxEntry };

/**
 * What a thread shows, oldest first: the server's messages, then sends it hasn't confirmed. An outbox entry whose message
 * has already arrived is left out, so the response and the socket echo can land in either order without a double bubble.
 */
export function threadItems(data: ChatMessagePages | undefined, outbox: OutboxEntry[] | undefined): ThreadItem[] {
  const messages = (data?.pages ?? []).flatMap((p) => p.data).sort((a, b) => a.seq - b.seq);
  const delivered = new Set(messages.map((m) => m.clientKey).filter((k): k is string => !!k));
  const items: ThreadItem[] = messages.map((message) => ({ key: message.clientKey ?? message.id, message, pending: null }));
  for (const pending of outbox ?? []) if (!delivered.has(pending.clientKey)) items.push({ key: pending.clientKey, message: null, pending });
  return items;
}
