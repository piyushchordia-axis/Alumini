import { memberRequestOf, notificationTarget, type NotificationDto } from "@illuminize/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Link } from "react-router-dom";
import { MemberRequestActions } from "@/components/admin/MemberActions";
import { IconBell, IconSettings } from "@/components/icons";
import { Button, EmptyState, LoadMore, Loading, PageHeader } from "@/components/ui";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { targetHref } from "@/lib/notificationLinks";
import { qk } from "@/lib/queryKeys";

function linkFor(slug: string, n: NotificationDto, isAdmin: boolean): string | null {
  const t = notificationTarget(n.type, n.data);
  return t ? targetHref(slug, t, { isAdmin }) : null;
}

export function NotificationsPage() {
  const { tenant, isTenantAdmin } = useMembership();
  const slug = tenant.slug;
  const qc = useQueryClient();
  const list = useInfiniteList(qk.notifications(slug), (cursor) => api.notifications.list(slug, { cursor, limit: 30 }));
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.notifications(slug) });
    void qc.invalidateQueries({ queryKey: qk.unread(slug) });
  };
  const readAll = useMutation({ mutationFn: () => api.notifications.markAllRead(slug), onSuccess: refresh });
  const readOne = useMutation({ mutationFn: (id: string) => api.notifications.markRead(slug, id), onSuccess: refresh });
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader
        title="Notifications"
        actions={
          <>
            <Link to={`/t/${slug}/app/notifications/settings`} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm text-slate-600 hover:bg-slate-100">
              <IconSettings size={16} />
              Settings
            </Link>
            <Button variant="outline" size="sm" onClick={() => readAll.mutate()} loading={readAll.isPending}>
              Mark all read
            </Button>
          </>
        }
      />
      {list.isLoading && <Loading />}
      {!list.isLoading && list.items.length === 0 && <EmptyState icon={<IconBell size={32} className="text-slate-400" />} title="You're all caught up" />}
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {list.items.map((n) => {
          const to = linkFor(slug, n, isTenantAdmin);
          const body = (
            <>
              <div className="flex items-start justify-between gap-2">
                <span className={clsx("text-sm", n.readAt ? "text-slate-700" : "font-semibold text-slate-900")}>{n.title}</span>
                <span className="shrink-0 text-xs text-slate-400">{timeAgo(n.createdAt)}</span>
              </div>
              {n.body && <p className="mt-0.5 text-sm text-slate-500">{n.body}</p>}
            </>
          );
          // A request to join that may still wait: its text links to the member, and Approve and Reject sit beside it,
          // never inside the link.
          const request = isTenantAdmin ? memberRequestOf(n) : null;
          const cls = clsx("block px-4 py-3 transition hover:bg-slate-50", !n.readAt && !request && "bg-primary/5");
          const markRead = () => !n.readAt && readOne.mutate(n.id);
          const text = to ? (
            <Link to={to} className={cls} onClick={markRead}>
              {body}
            </Link>
          ) : (
            <button className={clsx(cls, "w-full text-left")} onClick={markRead}>
              {body}
            </button>
          );
          return (
            <li key={n.id} className={clsx(request && !n.readAt && "bg-primary/5")}>
              {text}
              {request && (
                <div className="px-4 pb-3">
                  <MemberRequestActions slug={slug} subject={request} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <LoadMore hasNextPage={!!list.hasNextPage} isFetchingNextPage={list.isFetchingNextPage} fetchNextPage={() => void list.fetchNextPage()} />
    </div>
  );
}
