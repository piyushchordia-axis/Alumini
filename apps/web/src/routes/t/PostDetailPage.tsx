import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CommentList } from "@/components/feed/CommentList";
import { PostCard } from "@/components/feed/PostCard";
import { Card, ErrorBox, Loading } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

export function PostDetailPage() {
  const { tenant } = useMembership();
  const { postId = "" } = useParams();
  const navigate = useNavigate();
  const post = useQuery({ queryKey: qk.post(tenant.slug, postId), queryFn: () => api.posts.get(tenant.slug, postId) });
  if (post.isLoading) return <Loading />;
  if (post.error || !post.data) return <ErrorBox error={post.error ?? "Not found"} />;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link to={`/t/${tenant.slug}/app/feed`} className="text-sm text-slate-500 hover:text-slate-800">
        ← Back to feed
      </Link>
      <PostCard slug={tenant.slug} post={post.data} detail onDeleted={() => navigate(`/t/${tenant.slug}/app/feed`)} />
      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Comments</h2>
        <CommentList postId={postId} canComment={post.data.moderationStatus === "APPROVED"} />
      </Card>
    </div>
  );
}
