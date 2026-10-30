import { useState } from "react";
import { EventCard } from "@/components/events/EventCard";
import { EmptyState, ErrorBox, LinkButton, LoadMore, Loading, PageHeader, Tabs } from "@/components/ui";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

export function EventsPage() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const [scope, setScope] = useState<"upcoming" | "past">("upcoming");
  const list = useInfiniteList(qk.events(slug, { scope }), (cursor) => api.events.list(slug, { scope, cursor, limit: 20 }));
  return (
    <div className="space-y-4">
      <PageHeader title="Events & meetups" subtitle="Get-togethers organised by alumni, anywhere in the world" actions={<LinkButton to={`/t/${slug}/app/events/new`}>+ Plan a gathering</LinkButton>} />
      <Tabs value={scope} onChange={setScope} tabs={[{ value: "upcoming", label: "Upcoming" }, { value: "past", label: "Past" }]} className="w-fit" />
      {list.isLoading && <Loading />}
      {list.error && <ErrorBox error={list.error} />}
      <div className="grid gap-3">
        {list.items.map((e) => (
          <EventCard key={e.id} slug={slug} event={e} />
        ))}
      </div>
      {!list.isLoading && list.items.length === 0 && <EmptyState icon="📅" title={scope === "upcoming" ? "Nothing planned yet" : "No past events"} description="Heading somewhere? Post a meetup and see who wants to join." />}
      <LoadMore hasNextPage={!!list.hasNextPage} isFetchingNextPage={list.isFetchingNextPage} fetchNextPage={() => void list.fetchNextPage()} />
    </div>
  );
}
