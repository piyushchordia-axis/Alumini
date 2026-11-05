import type { ChatConversationDto, ChatInbox, TenantFeatures } from "@illuminize/shared";
import { chatKeys, conversationPreview, conversationTitle } from "@illuminize/shared/chat";
import clsx from "clsx";
import { Link, NavLink } from "react-router-dom";
import { IconBellOff, IconGroups, IconMail, IconMessages } from "@/components/icons";
import { Avatar, Button, EmptyState, ErrorBox, LinkButton, LoadMore, Loading, Tabs } from "@/components/ui";
import { useChatBadge, useNow } from "@/hooks/useChat";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { api } from "@/lib/api";
import { formatChatTime, inboxQuery, isMuted } from "@/lib/chat";
import { groupsPath } from "@/lib/groups";

function ConversationRow({ slug, c, now, query }: { slug: string; c: ChatConversationDto; now: Date; query: string }) {
  const name = conversationTitle(c);
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
        <span className="relative shrink-0">
          <Avatar name={name} src={c.peer?.avatarUrl} size="md" />
          {c.group && (
            <span aria-hidden className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-white text-slate-500 shadow ring-1 ring-slate-200">
              <IconGroups size={12} />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className={clsx("truncate text-sm", unread ? "font-semibold text-slate-900" : "font-medium text-slate-800")}>
              {c.group && <span className="sr-only">Group: </span>}
              {name}
            </span>
            <span className={clsx("shrink-0 text-xs", unread ? "font-semibold text-primary" : "text-slate-400")}>{formatChatTime(c.lastMessageAt, now)}</span>
          </span>
          <span className="flex items-center gap-2">
            <span className={clsx("truncate text-sm", unread ? "text-slate-800" : "text-slate-500", !c.lastMessage?.body && c.lastMessage && "italic")}>{conversationPreview(c)}</span>
            <span className="ml-auto flex shrink-0 items-center gap-1">
              {c.group?.archived && <span className="rounded-full bg-slate-100 px-1.5 text-[11px] text-slate-500">Archived</span>}
              {muted && (
                <span className="flex text-slate-400" title="Muted">
                  <IconBellOff size={14} />
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

/** What an empty Chats tab suggests, from whichever kinds of chat the institution has on. */
function emptyChatsHint(features: TenantFeatures): string {
  if (!features.messaging) return "When you join a group, its conversation shows here.";
  const message = features.directory ? "Open a member's profile in the Directory and choose Message this member" : "When you message a member, or accept a request, the conversation shows here";
  if (!features.groups) return `${message}.`;
  return features.directory ? `${message}, or join a group.` : "When you message a member, accept a request or join a group, the conversation shows here.";
}

/**
 * The inbox: conversations, groups' among them, under Chats, and requests waiting for an answer under Requests. With
 * direct messages off there are no requests, so there's no Requests tab.
 */
export function ConversationList({ slug, inbox: asked, onInboxChange, features }: { slug: string; inbox: ChatInbox; onInboxChange: (inbox: ChatInbox) => void; features: TenantFeatures }) {
  const now = useNow();
  const badge = useChatBadge(slug, true);
  const inbox: ChatInbox = features.messaging ? asked : "MAIN";
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
      {features.messaging && (
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
      )}
      <div role={features.messaging ? "tabpanel" : "region"} aria-label={inbox === "MAIN" ? "Chats" : "Requests"} className="min-h-0 flex-1 overflow-y-auto border-t border-slate-100">
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
                icon={<IconMessages size={32} className="text-slate-400" />}
                title="No conversations yet"
                description={emptyChatsHint(features)}
                action={
                  features.groups ? (
                    <LinkButton to={groupsPath(slug)} variant="outline" className="min-h-11">
                      Find a group
                    </LinkButton>
                  ) : undefined
                }
              />
            ) : (
              <EmptyState icon={<IconMail size={32} className="text-slate-400" />} title="No message requests" description="When someone you haven't talked to messages you, it waits here until you accept or decline." />
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
