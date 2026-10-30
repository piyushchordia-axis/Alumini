import type { NotificationDto } from "@illuminize/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Link } from "react-router-dom";
import { Button, EmptyState, LoadMore, Loading, PageHeader } from "@/components/ui";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { qk } from "@/lib/queryKeys";

function linkFor(slug: string, n: NotificationDto, isAdmin: boolean): string | null {
  const d = n.data as { postId?: string; contentType?: string; contentId?: string; eventId?: string; membershipId?: string; reportId?: string };
  const base = `/t/${slug}/app`;
  switch (n.type) {
    case "POST_COMMENT":
    case "POST_REACTION":
      return d.postId ? `${base}/feed/${d.postId}` : null;
    case "EVENT_RSVP":
    case "EVENT_CANCELLED":
      return d.eventId ? `${base}/events/${d.eventId}` : null;
    case "NEW_MEMBER_PENDING":
      return isAdmin ? `/t/${slug}/admin/members?status=PENDING` : null;
    case "CONTENT_PENDING":
      return isAdmin ? `/t/${slug}/admin/moderation` : null;
    case "REPORT_FILED":
      return isAdmin ? `/t/${slug}/admin/reports` : null;
    case "CONTENT_APPROVED":
    case "CONTENT_REJECTED":
    case "CONTENT_REMOVED":
      if (d.contentType === "POST" && d.contentId) return `${base}/feed/${d.contentId}`;
      if (d.contentType === "JOB" && d.contentId) return `${base}/jobs/${d.contentId}`;
      if (d.contentType === "FUNDING" && d.contentId) return `${base}/funding/${d.contentId}`;
      if (d.contentType === "EVENT" && d.contentId) return `${base}/events/${d.contentId}`;
      if (d.postId) return `${base}/feed/${d.postId}`;
      return `${base}/my-content`;
    default:
      return null;
  }
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
          <Button variant="outline" size="sm" onClick={() => readAll.mutate()} loading={readAll.isPending}>
            Mark all read
          </Button>
        }
      />
      {list.isLoading && <Loading />}
      {!list.isLoading && list.items.length === 0 && <EmptyState icon="🔔" title="You're all caught up" />}
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
          const cls = clsx("block px-4 py-3 transition hover:bg-slate-50", !n.readAt && "bg-primary/5");
          return (
            <li key={n.id}>
              {to ? (
                <Link to={to} className={cls} onClick={() => !n.readAt && readOne.mutate(n.id)}>
                  {body}
                </Link>
              ) : (
                <button className={clsx(cls, "w-full text-left")} onClick={() => !n.readAt && readOne.mutate(n.id)}>
                  {body}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <LoadMore hasNextPage={!!list.hasNextPage} isFetchingNextPage={list.isFetchingNextPage} fetchNextPage={() => void list.fetchNextPage()} />
    </div>
  );
}
