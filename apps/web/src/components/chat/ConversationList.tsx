import type { ChatConversationDto, ChatInbox } from "@illuminize/shared";
import { chatKeys, conversationPreview } from "@illuminize/shared/chat";
import clsx from "clsx";
import { Link, NavLink } from "react-router-dom";
import { Avatar, Button, EmptyState, ErrorBox, LoadMore, Loading, Tabs } from "@/components/ui";
import { useChatBadge, useNow } from "@/hooks/useChat";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { api } from "@/lib/api";
import { formatChatTime, inboxQuery, isMuted, peerName } from "@/lib/chat";

function ConversationRow({ slug, c, now, query }: { slug: string; c: ChatConversationDto; now: Date; query: string }) {
  const name = peerName(c.peer);
  const unread = c.unread > 0;
  const muted = isMuted(c, now);
  return (
    <li>
      <NavLink
        to={`/t/${slug}/app/messages/${c.id}${query}`}
        className={({ isActive }) =>
          clsx("flex min-h-16 items-center gap-3 px-4 py-3 transition focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary", isActive ? "bg-primary/10" : "hover:bg-slate-50")
        }
      >
        <Avatar name={name} src={c.peer?.avatarUrl} size="md" />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className={clsx("truncate text-sm", unread ? "font-semibold text-slate-900" : "font-medium text-slate-800")}>{name}</span>
            <span className={clsx("shrink-0 text-xs", unread ? "font-semibold text-primary" : "text-slate-400")}>{formatChatTime(c.lastMessageAt, now)}</span>
          </span>
          <span className="flex items-center gap-2">
            <span className={clsx("truncate text-sm", unread ? "text-slate-800" : "text-slate-500", !c.lastMessage?.body && c.lastMessage && "italic")}>{conversationPreview(c)}</span>
            <span className="ml-auto flex shrink-0 items-center gap-1">
              {muted && (
                <span className="text-xs text-slate-400" title="Muted">
                  <span aria-hidden>🔕</span>
                  <span className="sr-only">Muted</span>
                </span>
              )}
              {unread && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-white">
                  {c.unread > 99 ? "99+" : c.unread}
                  <span className="sr-only"> unread</span>
                </span>
              )}
            </span>
          </span>
        </span>
      </NavLink>
    </li>
  );
}

/** The inbox: conversations under Chats, and requests waiting for an answer under Requests. */
export function ConversationList({ slug, inbox, onInboxChange, directoryOn }: { slug: string; inbox: ChatInbox; onInboxChange: (inbox: ChatInbox) => void; directoryOn: boolean }) {
  const now = useNow();
  const badge = useChatBadge(slug, true);
  const list = useInfiniteList(chatKeys.list(slug, inbox), (cursor) => api.chat.conversations(slug, { inbox, cursor, limit: 20 }));
  const requests = badge.data?.requests ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-4">
        <h1 className="text-xl font-semibold text-slate-900">Messages</h1>
        <Link to={`/t/${slug}/app/messages/blocked`} className="inline-flex min-h-11 items-center rounded-lg px-2 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-800">
          Blocked members
        </Link>
      </div>
      <div className="px-4 pb-3">
        <Tabs
          className="w-full [&>button]:min-h-11 [&>button]:flex-1"
          value={inbox}
          onChange={onInboxChange}
          tabs={[
            { value: "MAIN", label: "Chats" },
            { value: "REQUESTS", label: "Requests", ...(requests > 0 ? { count: requests } : {}) },
          ]}
        />
      </div>
      <div role="tabpanel" aria-label={inbox === "MAIN" ? "Chats" : "Requests"} className="min-h-0 flex-1 overflow-y-auto border-t border-slate-100">
        {list.isLoading ? (
          <Loading />
        ) : list.error && list.items.length === 0 ? (
          <div className="space-y-3 p-4">
            <ErrorBox error={list.error} />
            <Button variant="outline" size="sm" className="min-h-11" onClick={() => void list.refetch()}>
              Retry loading
            </Button>
          </div>
        ) : list.items.length === 0 ? (
          <div className="p-4">
            {inbox === "MAIN" ? (
              <EmptyState
                icon="✉️"
                title="No conversations yet"
                description={directoryOn ? "Open a member's profile in the Directory and choose Message this member." : "When you message a member, or accept a request, the conversation shows here."}
              />
            ) : (
              <EmptyState icon="📨" title="No message requests" description="When someone you haven't talked to messages you, it waits here until you accept or decline." />
            )}
          </div>
        ) : (
          <>
            <ul className="divide-y divide-slate-100">
              {list.items.map((c) => (
                <ConversationRow key={c.id} slug={slug} c={c} now={now} query={inboxQuery(inbox)} />
              ))}
            </ul>
            <LoadMore hasNextPage={!!list.hasNextPage} isFetchingNextPage={list.isFetchingNextPage} fetchNextPage={() => void list.fetchNextPage()} />
          </>
        )}
      </div>
    </div>
  );
}
