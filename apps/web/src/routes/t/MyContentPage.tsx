import { useState } from "react";
import { EventCard } from "@/components/events/EventCard";
import { PostCard } from "@/components/feed/PostCard";
import { FundingCard } from "@/components/funding/FundingCard";
import { JobCard } from "@/components/jobs/JobCard";
import { EmptyState, LoadMore, Loading, PageHeader, Tabs } from "@/components/ui";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

type Tab = "posts" | "jobs" | "funding" | "events";

export function MyContentPage() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const [tab, setTab] = useState<Tab>("posts");
  const posts = useInfiniteList(qk.posts(slug, { mine: true }), (cursor) => api.posts.list(slug, { mine: true, cursor, limit: 20 }), tab === "posts");
  const jobs = useInfiniteList(qk.jobs(slug, { mine: true }), (cursor) => api.jobs.list(slug, { mine: true, cursor, limit: 20 }), tab === "jobs");
  const funding = useInfiniteList(qk.funding(slug, { mine: true }), (cursor) => api.funding.list(slug, { mine: true, cursor, limit: 20 }), tab === "funding");
  const events = useInfiniteList(qk.events(slug, { mine: true, scope: "upcoming" }), (cursor) => api.events.list(slug, { mine: true, scope: "upcoming", cursor, limit: 20 }), tab === "events");
  const active = { posts, jobs, funding, events }[tab];
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="My posts & listings" subtitle="Everything you've shared, including items awaiting approval" />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "posts", label: "Posts" }, { value: "jobs", label: "Jobs" }, { value: "funding", label: "Funding" }, { value: "events", label: "Events" }]} className="w-fit" />
      {active.isLoading && <Loading />}
      <div className="grid gap-3">
        {tab === "posts" && posts.items.map((p) => <PostCard key={p.id} slug={slug} post={p} />)}
        {tab === "jobs" && jobs.items.map((j) => <JobCard key={j.id} slug={slug} job={j} />)}
        {tab === "funding" && funding.items.map((f) => <FundingCard key={f.id} slug={slug} item={f} />)}
        {tab === "events" && events.items.map((e) => <EventCard key={e.id} slug={slug} event={e} />)}
      </div>
      {!active.isLoading && active.items.length === 0 && <EmptyState title="Nothing here yet" />}
      <LoadMore hasNextPage={!!active.hasNextPage} isFetchingNextPage={active.isFetchingNextPage} fetchNextPage={() => void active.fetchNextPage()} />
    </div>
  );
}
