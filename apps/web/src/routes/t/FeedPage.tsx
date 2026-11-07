import { feedEmpty, LATEST_POSTS_TITLE, listView, PINNED_POSTS_LABEL } from "@illuminize/shared";
import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { ListError } from "@/components/common/ListBody";
import { CelebrationsCard } from "@/components/feed/CelebrationsCard";
import { DigestBanner } from "@/components/feed/DigestBanner";
import { ExploreRow } from "@/components/feed/ExploreRow";
import { PostCard } from "@/components/feed/PostCard";
import { PostComposer } from "@/components/feed/PostComposer";
import { UpcomingEvents } from "@/components/feed/UpcomingEvents";
import { IconFeed } from "@/components/icons";
import { ProfileStrengthCard } from "@/components/profile/ProfileStrengthCard";
import { Button, EmptyState, ListSkeleton, LoadMore, PageHeader } from "@/components/ui";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { usePhoneLayout } from "@/hooks/useMediaQuery";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import type { FeedArrival } from "@/lib/emptyStates";
import { qk } from "@/lib/queryKeys";

/**
 * Whether this is the first arrival on a history entry Write a post opened. The entry keeps its `compose` state, so
 * coming Back to it later (from a post, say) or reloading it (pull to refresh, or Back from another site) would focus the
 * composer again and bring up a phone's keyboard unasked. The entries are remembered for the browser tab's session, as
 * its history is, so a reload remembers them too; where the browser refuses storage, for this page load only.
 */
const COMPOSED = "illuminize.composed";
const composedHere = new Set<string>();
function firstArrival(key: string): boolean {
  if (composedHere.has(key)) return false;
  composedHere.add(key);
  try {
    const seen: unknown = JSON.parse(sessionStorage.getItem(COMPOSED) ?? "[]");
    const keys = Array.isArray(seen) ? seen.filter((k): k is string => typeof k === "string") : [];
    if (keys.includes(key)) return false;
    // The latest twenty are plenty: an older one is far back in the history.
    sessionStorage.setItem(COMPOSED, JSON.stringify([...keys, key].slice(-20)));
  } catch {
    // Storage refused or unreadable: the set above still covers this page load.
  }
  return true;
}

export function FeedPage() {
  const member = useMembership();
  const { tenant } = member;
  const slug = tenant.slug;
  const composer = useRef<HTMLTextAreaElement>(null);
  const empty = feedEmpty(member);
  // Write a post elsewhere (My posts) links here with `compose`: the composer is the form, so arriving puts focus in it.
  const { key, state } = useLocation();
  const compose = !!(state as FeedArrival | null)?.compose;
  useEffect(() => {
    if (compose && firstArrival(key)) composer.current?.focus();
  }, [compose, key]);
  const list = useInfiniteList(qk.posts(slug), (cursor) => api.posts.list(slug, { cursor, limit: 10 }));
  const pinned = list.first?.pinned ?? [];
  // Pinned posts come with the first page, so they count as what the feed has.
  const view = listView(list, list.items.length + pinned.length);
  // A wide screen's sidebar lists every section already.
  const phone = usePhoneLayout();
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="Community" subtitle={`What's happening at ${tenant.shortName ?? tenant.name}`} />
      {phone && <ExploreRow />}
      <ProfileStrengthCard />
      <DigestBanner slug={slug} />
      <CelebrationsCard slug={slug} />
      {phone && <UpcomingEvents slug={slug} />}
      <PostComposer inputRef={composer} />
      {view === "loading" && <ListSkeleton shape="post" />}
      {view === "error" && <ListError error={list.error} onRetry={list.retry} retrying={list.retrying} />}
      {pinned.length > 0 && (
        // Paints nothing of its own, so its cards stay white on the member's page; each says it's pinned.
        <section aria-label={PINNED_POSTS_LABEL} className="space-y-4">
          {pinned.map((p) => (
            <PostCard key={p.id} slug={slug} post={p} />
          ))}
        </section>
      )}
      {pinned.length > 0 && list.items.length > 0 && (
        // Grey text on the page, a shade darker on a tint or a photo ([data-backdrop]), as the phone's pageMuted is.
        <h2 className="flex items-center gap-3 pt-1 text-sm font-semibold text-slate-500">
          {LATEST_POSTS_TITLE}
          <span aria-hidden className="h-px flex-1 bg-slate-300" />
        </h2>
      )}
      {list.items.map((p) => (
        <PostCard key={p.id} slug={slug} post={p} />
      ))}
      {view === "empty" && (
        <EmptyState
          icon={<IconFeed />}
          title={empty.title}
          description={empty.description}
          // The composer is just above, so its way on is to start writing there.
          action={empty.action && <Button variant={empty.action.variant} onClick={() => composer.current?.focus()}>{empty.action.label}</Button>}
        />
      )}
      <LoadMore hasNextPage={!!list.hasNextPage} isFetchingNextPage={list.isFetchingNextPage} fetchNextPage={() => void list.fetchNextPage()} error={list.nextPageError} />
    </div>
  );
}
