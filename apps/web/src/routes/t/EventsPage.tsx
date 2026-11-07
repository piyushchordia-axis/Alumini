import { eventsEmpty } from "@illuminize/shared";
import { useState } from "react";
import { ListError } from "@/components/common/ListBody";
import { EventCard } from "@/components/events/EventCard";
import { IconEvents } from "@/components/icons";
import { EmptyState, LinkButton, ListSkeleton, LoadMore, PageHeader, Tabs } from "@/components/ui";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

export function EventsPage() {
  const member = useMembership();
  const { tenant } = member;
  const slug = tenant.slug;
  const [scope, setScope] = useState<"upcoming" | "past">("upcoming");
  const list = useInfiniteList(qk.events(slug, { scope }), (cursor) => api.events.list(slug, { scope, cursor, limit: 20 }));
  const empty = eventsEmpty(member, scope);
  return (
    <div className="space-y-4">
      <PageHeader title="Events & meetups" subtitle="Get-togethers organised by alumni, anywhere in the world" actions={<LinkButton to={`/t/${slug}/app/events/new`}>+ Plan a gathering</LinkButton>} />
      <Tabs value={scope} onChange={setScope} tabs={[{ value: "upcoming", label: "Upcoming" }, { value: "past", label: "Past" }]} className="w-fit" />
      {list.view === "loading" && <ListSkeleton shape="event" />}
      {list.view === "error" && <ListError error={list.error} onRetry={list.retry} retrying={list.retrying} />}
      <div className="grid gap-3">
        {list.items.map((e) => (
          <EventCard key={e.id} slug={slug} event={e} />
        ))}
      </div>
      {list.view === "empty" && (
        <EmptyState icon={<IconEvents />} title={empty.title} description={empty.description} action={empty.action && <LinkButton to={`/t/${slug}/app/events/new`} variant={empty.action.variant}>{empty.action.label}</LinkButton>} />
      )}
      <LoadMore hasNextPage={!!list.hasNextPage} isFetchingNextPage={list.isFetchingNextPage} fetchNextPage={() => void list.fetchNextPage()} error={list.nextPageError} />
    </div>
  );
}
