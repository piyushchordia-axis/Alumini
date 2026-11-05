import { chatAvailable } from "@illuminize/shared";
import { BLOCKED_LIST_EXPLAINED, chatKeys } from "@illuminize/shared/chat";
import { Link } from "react-router-dom";
import { BlockMemberButton } from "@/components/chat/BlockMemberButton";
import { IconShield } from "@/components/icons";
import { Avatar, Button, EmptyState, ErrorBox, LoadMore, Loading } from "@/components/ui";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";

export function BlockedMembersPage() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const list = useInfiniteList(chatKeys.blocks(slug), (cursor) => api.chat.blocks(slug, { cursor, limit: 30 }));
  // With messages and groups off this is all that's left of them, so there's no inbox to go back to.
  const messagingOn = chatAvailable(tenant.settings.features, true);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-slate-200 px-1 py-1.5 sm:px-3">
        {messagingOn && (
          <Link to={`/t/${slug}/app/messages`} aria-label="Back to messages" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-primary md:hidden">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </Link>
        )}
        <h2 className="flex min-h-11 items-center px-1 text-base font-semibold text-slate-900">Blocked members</h2>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <p className="mb-4 text-sm text-slate-500">{BLOCKED_LIST_EXPLAINED}</p>
        {list.isLoading ? (
          <Loading />
        ) : list.error && list.items.length === 0 ? (
          <div className="space-y-3">
            <ErrorBox error={list.error} />
            <Button variant="outline" size="sm" className="min-h-11" onClick={() => void list.refetch()}>
              Retry loading
            </Button>
          </div>
        ) : list.items.length === 0 ? (
          <EmptyState icon={<IconShield size={32} className="text-slate-400" />} title="You haven't blocked anyone" description="You can block a member from their profile or from a conversation with them." />
        ) : (
          <>
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {list.items.map((b) => (
                <li key={b.member.id} className="flex items-center gap-3 px-4 py-3">
                  <Avatar name={b.member.fullName} src={b.member.avatarUrl} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">{b.member.fullName}</p>
                    <p className="text-xs text-slate-500">Blocked {formatDate(b.createdAt)}</p>
                  </div>
                  <BlockMemberButton slug={slug} member={b.member} blocked size="md" />
                </li>
              ))}
            </ul>
            <LoadMore hasNextPage={!!list.hasNextPage} isFetchingNextPage={list.isFetchingNextPage} fetchNextPage={() => void list.fetchNextPage()} />
          </>
        )}
      </div>
    </div>
  );
}
