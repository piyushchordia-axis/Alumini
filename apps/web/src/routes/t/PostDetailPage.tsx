import { postTakesComments } from "@illuminize/shared";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { BackLink } from "@/components/common/BackLink";
import { PageLoad } from "@/components/common/PageLoad";
import { CommentList } from "@/components/feed/CommentList";
import { PostCard } from "@/components/feed/PostCard";
import { Card } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { usePageQuery } from "@/hooks/usePageQuery";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

export function PostDetailPage() {
  const { tenant } = useMembership();
  const { postId = "" } = useParams();
  const navigate = useNavigate();
  const post = useQuery({ queryKey: qk.post(tenant.slug, postId), queryFn: () => api.posts.get(tenant.slug, postId) });
  const page = usePageQuery(post);
  const back = <BackLink to={`/t/${tenant.slug}/app/feed`}>Back to feed</BackLink>;
  // Only with nothing to show: a refetch failing in the background keeps the post on screen.
  if (!post.data)
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        {back}
        <PageLoad page={page} shape="article" />
      </div>
    );
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {back}
      <PostCard slug={tenant.slug} post={post.data} detail onDeleted={() => navigate(`/t/${tenant.slug}/app/feed`)} />
      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Comments</h2>
        <CommentList postId={postId} canComment={postTakesComments(post.data)} />
      </Card>
    </div>
  );
}
