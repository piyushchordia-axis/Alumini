import { feedEmpty } from "@illuminize/shared";
import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { CelebrationsCard } from "@/components/feed/CelebrationsCard";
import { DigestBanner } from "@/components/feed/DigestBanner";
import { PostCard } from "@/components/feed/PostCard";
import { PostComposer } from "@/components/feed/PostComposer";
import { IconFeed } from "@/components/icons";
import { ProfileStrengthCard } from "@/components/profile/ProfileStrengthCard";
import { Button, EmptyState, ErrorBox, LoadMore, Loading, PageHeader } from "@/components/ui";
import { useInfiniteList } from "@/hooks/useInfiniteList";
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
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="Community" subtitle={`What's happening at ${tenant.shortName ?? tenant.name}`} />
      <ProfileStrengthCard />
      <DigestBanner slug={slug} />
      <CelebrationsCard slug={slug} />
      <PostComposer inputRef={composer} />
      {list.isLoading && <Loading />}
      {list.error && <ErrorBox error={list.error} />}
      {pinned.map((p) => (
        <PostCard key={p.id} slug={slug} post={p} />
      ))}
      {list.items.map((p) => (
        <PostCard key={p.id} slug={slug} post={p} />
      ))}
      {!list.isLoading && !list.error && list.items.length === 0 && pinned.length === 0 && (
        <EmptyState
          icon={<IconFeed />}
          title={empty.title}
          description={empty.description}
          // The composer is just above, so its way on is to start writing there.
          action={empty.action && <Button variant={empty.action.variant} onClick={() => composer.current?.focus()}>{empty.action.label}</Button>}
        />
      )}
      <LoadMore hasNextPage={!!list.hasNextPage} isFetchingNextPage={list.isFetchingNextPage} fetchNextPage={() => void list.fetchNextPage()} />
    </div>
  );
}
