import { chatKeys } from "@illuminize/shared/chat";
import { useSearchParams } from "react-router-dom";
import { BusinessCard } from "@/components/businesses/BusinessCard";
import { OwnedGroupCard } from "@/components/groups/GroupCards";
import { EventCard } from "@/components/events/EventCard";
import { PostCard } from "@/components/feed/PostCard";
import { FundingCard } from "@/components/funding/FundingCard";
import { JobCard } from "@/components/jobs/JobCard";
import { EmptyState, ErrorBox, LoadMore, Loading, PageHeader, Tabs } from "@/components/ui";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

type Tab = "posts" | "jobs" | "funding" | "businesses" | "groups" | "events" | "pastEvents";

export function MyContentPage() {
  const { tenant, membership } = useMembership();
  const slug = tenant.slug;
  const f = tenant.settings.features;
  const tabs = (
    [
      { value: "posts", label: "Posts", on: f.feed },
      { value: "jobs", label: "Jobs", on: f.jobs },
      { value: "funding", label: "Funding", on: f.funding },
      { value: "businesses", label: "Businesses", on: f.businesses },
      { value: "groups", label: "Groups", on: f.groups && membership.chatEligible },
      { value: "events", label: "Upcoming events", on: f.events },
      { value: "pastEvents", label: "Past events", on: f.events },
    ] satisfies Array<{ value: Tab; label: string; on: boolean }>
  ).filter((t) => t.on);
  // The tab is in the URL, so a notice about a group's review can open this on Groups, and Back returns to the same tab.
  const [params, setParams] = useSearchParams();
  const picked = tabs.find((t) => t.value === params.get("tab"))?.value;
  const tab: Tab = picked ?? tabs[0]?.value ?? "posts";
  const setTab = (next: Tab) => setParams((old) => {
    const p = new URLSearchParams(old);
    p.set("tab", next);
    return p;
  }, { replace: true });
  const posts = useInfiniteList(qk.posts(slug, { mine: true }), (cursor) => api.posts.list(slug, { mine: true, cursor, limit: 20 }), tab === "posts");
  const jobs = useInfiniteList(qk.jobs(slug, { mine: true }), (cursor) => api.jobs.list(slug, { mine: true, cursor, limit: 20 }), tab === "jobs");
  const funding = useInfiniteList(qk.funding(slug, { mine: true }), (cursor) => api.funding.list(slug, { mine: true, cursor, limit: 20 }), tab === "funding");
  const businesses = useInfiniteList(qk.businesses(slug, { mine: true }), (cursor) => api.businesses.list(slug, { mine: true, cursor, limit: 20 }), tab === "businesses");
  // Groups they own, with how moderation left each one: the only place a rejected or removed group's note shows.
  const groups = useInfiniteList(chatKeys.groupList(slug, "OWNED"), (cursor) => api.chat.groups.list(slug, { scope: "OWNED", cursor, limit: 20 }), tab === "groups");
  const events = useInfiniteList(qk.events(slug, { mine: true, scope: "upcoming" }), (cursor) => api.events.list(slug, { mine: true, scope: "upcoming", cursor, limit: 20 }), tab === "events");
  const pastEvents = useInfiniteList(qk.events(slug, { mine: true, scope: "past" }), (cursor) => api.events.list(slug, { mine: true, scope: "past", cursor, limit: 20 }), tab === "pastEvents");
  const active = { posts, jobs, funding, businesses, groups, events, pastEvents }[tab];
  if (tabs.length === 0) return <EmptyState title="Nothing to show" description="Your institution has switched off posts, jobs, funding, businesses, groups and events." />;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="My posts & listings" subtitle="Everything you've shared, including items awaiting approval" />
      <Tabs value={tab} onChange={setTab} tabs={tabs.map(({ value, label }) => ({ value, label }))} className="max-w-full sm:w-fit" />
      {active.isLoading && <Loading />}
      {active.error && <ErrorBox error={active.error} />}
      <div className="grid gap-3">
        {tab === "posts" && posts.items.map((p) => <PostCard key={p.id} slug={slug} post={p} />)}
        {tab === "jobs" && jobs.items.map((j) => <JobCard key={j.id} slug={slug} job={j} />)}
        {tab === "funding" && funding.items.map((f) => <FundingCard key={f.id} slug={slug} item={f} />)}
        {tab === "businesses" && businesses.items.map((b) => <BusinessCard key={b.id} slug={slug} item={b} />)}
        {tab === "groups" && groups.items.map((g) => <OwnedGroupCard key={g.id} slug={slug} group={g} />)}
        {tab === "events" && events.items.map((e) => <EventCard key={e.id} slug={slug} event={e} />)}
        {tab === "pastEvents" && pastEvents.items.map((e) => <EventCard key={e.id} slug={slug} event={e} />)}
      </div>
      {!active.isLoading && !active.error && active.items.length === 0 && <EmptyState title="Nothing here yet" />}
      <LoadMore hasNextPage={!!active.hasNextPage} isFetchingNextPage={active.isFetchingNextPage} fetchNextPage={() => void active.fetchNextPage()} />
    </div>
  );
}
