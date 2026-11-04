import { CelebrationsCard } from "@/components/feed/CelebrationsCard";
import { DigestBanner } from "@/components/feed/DigestBanner";
import { PostCard } from "@/components/feed/PostCard";
import { PostComposer } from "@/components/feed/PostComposer";
import { ProfileStrengthCard } from "@/components/profile/ProfileStrengthCard";
import { EmptyState, ErrorBox, LoadMore, Loading, PageHeader } from "@/components/ui";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

export function FeedPage() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const list = useInfiniteList(qk.posts(slug), (cursor) => api.posts.list(slug, { cursor, limit: 10 }));
  const pinned = list.first?.pinned ?? [];
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="Community" subtitle={`What's happening at ${tenant.shortName ?? tenant.name}`} />
      <ProfileStrengthCard />
      <DigestBanner slug={slug} />
      <CelebrationsCard slug={slug} />
      <PostComposer />
      {list.isLoading && <Loading />}
      {list.error && <ErrorBox error={list.error} />}
      {pinned.map((p) => (
        <PostCard key={p.id} slug={slug} post={p} />
      ))}
      {list.items.map((p) => (
        <PostCard key={p.id} slug={slug} post={p} />
      ))}
      {!list.isLoading && list.items.length === 0 && pinned.length === 0 && (
        <EmptyState title={`No posts yet at ${tenant.shortName ?? tenant.name}`} description="Be the first to share an update with your batchmates." />
      )}
      <LoadMore hasNextPage={!!list.hasNextPage} isFetchingNextPage={list.isFetchingNextPage} fetchNextPage={() => void list.fetchNextPage()} />
    </div>
  );
}
