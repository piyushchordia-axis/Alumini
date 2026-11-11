import type { ChatConversationDto, ChatInbox, TenantFeatures } from "@illuminize/shared";
import { chatKeys, conversationPreview, conversationTitle, emptyChatsActions, emptyChatsHint, peerYears, type EmptyChatsTarget } from "@illuminize/shared/chat";
import clsx from "clsx";
import { Link, NavLink } from "react-router-dom";
import { ListError } from "@/components/common/ListBody";
import { IconBellOff, IconGroups, IconMail, IconMessages } from "@/components/icons";
import { Avatar, Badge, EmptyState, LinkButton, ListSkeleton, LoadMore, Tabs } from "@/components/ui";
import { useChatBadge, useNow } from "@/hooks/useChat";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { formatChatTime, inboxQuery, isMuted } from "@/lib/chat";
import { groupsPath } from "@/lib/groups";

function ConversationRow({ slug, c, now, query }: { slug: string; c: ChatConversationDto; now: Date; query: string }) {
  const name = conversationTitle(c);
  const years = peerYears(c);
  const unread = c.unread > 0;
  const muted = isMuted(c, now);
  return (
    <li>
      <NavLink
        to={`/t/${slug}/app/messages/${c.id}${query}`}
        className={({ isActive }) =>
          // The open conversation's tint takes the secondary grey (dim-text), which reads on any brand's 10%.
          clsx("flex min-h-16 items-center gap-3 px-4 py-3 transition focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary", isActive ? "bg-primary/10 dim-text" : "hover:bg-slate-50")
        }
      >
        <span className="relative shrink-0">
          <Avatar name={name} src={c.peer?.avatarUrl} size="md" toneKey={c.peer?.id} />
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
              {years && <span className="font-normal text-slate-500"> · {years}</span>}
            </span>
            <time dateTime={c.lastMessageAt} className={clsx("shrink-0 text-xs", unread ? "font-semibold text-primary-ink" : "text-slate-500")}>
              {formatChatTime(c.lastMessageAt, now)}
            </time>
          </span>
          <span className="flex items-center gap-2">
            <span className={clsx("truncate text-sm", unread ? "text-slate-800" : "text-slate-500", !c.lastMessage?.body && c.lastMessage && "italic")}>{conversationPreview(c)}</span>
            <span className="ml-auto flex shrink-0 items-center gap-1">
              {c.group?.archived && <Badge>Archived</Badge>}
              {muted && (
                <span className="flex" title="Muted">
                  <IconBellOff size={14} className="text-slate-400" />
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

const EMPTY_CHATS_PATHS: Readonly<Record<EmptyChatsTarget, (slug: string) => string>> = { directory: (slug) => `/t/${slug}/app/directory`, groups: (slug) => groupsPath(slug) };

/**
 * The inbox: conversations, groups' among them, under Chats, and requests waiting for an answer under Requests. With
 * direct messages off there are no requests, so there's no Requests tab.
 */
export function ConversationList({ slug, inbox: asked, onInboxChange, features }: { slug: string; inbox: ChatInbox; onInboxChange: (inbox: ChatInbox) => void; features: TenantFeatures }) {
  const now = useNow();
  const { membership } = useMembership();
  const badge = useChatBadge(slug, true);
  const inbox: ChatInbox = features.messaging ? asked : "MAIN";
  const list = useInfiniteList(chatKeys.list(slug, inbox), (cursor) => api.chat.conversations(slug, { inbox, cursor, limit: 20 }));
  const requests = badge.data?.requests ?? 0;
  const emptyActions = emptyChatsActions(features, membership.chatEligible);

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
        {list.view === "loading" ? (
          <ListSkeleton shape="row" frame="flush" className="px-4" />
        ) : list.view === "error" ? (
          <ListError error={list.error} onRetry={list.retry} retrying={list.retrying} className="p-4" />
        ) : list.view === "empty" ? (
          <div className="p-4">
            {inbox === "MAIN" ? (
              <EmptyState
                icon={<IconMessages />}
                title="No conversations yet"
                description={emptyChatsHint(features)}
                action={
                  emptyActions.length > 0
                    ? emptyActions.map((a) => (
                        <LinkButton key={a.target} to={EMPTY_CHATS_PATHS[a.target](slug)} variant={a.variant}>
                          {a.label}
                        </LinkButton>
                      ))
                    : undefined
                }
              />
            ) : (
              <EmptyState icon={<IconMail />} title="No message requests" description="When someone you haven't talked to messages you, it waits here until you accept or decline." />
            )}
          </div>
        ) : (
          <>
            <ul className="divide-y divide-slate-100">
              {list.items.map((c) => (
                <ConversationRow key={c.id} slug={slug} c={c} now={now} query={inboxQuery(inbox)} />
              ))}
            </ul>
            <LoadMore hasNextPage={!!list.hasNextPage} isFetchingNextPage={list.isFetchingNextPage} fetchNextPage={() => void list.fetchNextPage()} error={list.nextPageError} />
          </>
        )}
      </div>
    </div>
  );
}
