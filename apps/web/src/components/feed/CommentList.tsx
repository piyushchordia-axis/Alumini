import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { MemberLink } from "@/components/common/MemberLink";
import { ReportButton } from "@/components/moderation/ReportDialog";
import { Button, LoadMore, Textarea } from "@/components/ui";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { qk } from "@/lib/queryKeys";
import { toast } from "@/stores/uiStore";

export function CommentList({ postId, canComment }: { postId: string; canComment: boolean }) {
  const { tenant, isTenantAdmin } = useMembership();
  const slug = tenant.slug;
  const qc = useQueryClient();
  const list = useInfiniteList(qk.comments(slug, postId), (cursor) => api.posts.comments.list(slug, postId, { cursor, limit: 20 }));
  const [body, setBody] = useState("");
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: qk.comments(slug, postId) });
    void qc.invalidateQueries({ queryKey: qk.post(slug, postId) });
    void qc.invalidateQueries({ queryKey: ["posts", slug] });
  };
  const add = useMutation({
    mutationFn: () => api.posts.comments.create(slug, postId, { body: body.trim() }),
    onSuccess: () => {
      setBody("");
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.posts.comments.remove(slug, postId, id),
    onSuccess: invalidate,
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="space-y-4">
      {canComment && (
        <div className="flex gap-2">
          <Textarea rows={2} aria-label="Write a comment" placeholder="Write a comment…" value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} />
          <Button onClick={() => add.mutate()} loading={add.isPending} disabled={!body.trim()} className="self-end">
            Reply
          </Button>
        </div>
      )}
      <ul className="space-y-3">
        {list.items.map((c) => (
          <li key={c.id} className="rounded-lg bg-slate-50 p-3">
            <div className="flex items-start justify-between gap-2">
              <MemberLink slug={slug} member={c.author} meta={timeAgo(c.createdAt)} size="sm" />
              <span className="flex items-center gap-3 text-xs text-slate-400">
                {c.moderationStatus === "REMOVED" && <span className="text-red-500">Removed</span>}
                {c.isMine || isTenantAdmin ? (
                  <button onClick={() => confirm("Delete comment?") && remove.mutate(c.id)} className="hover:text-red-600">
                    Delete
                  </button>
                ) : (
                  <ReportButton slug={slug} contentType="COMMENT" contentId={c.id} />
                )}
              </span>
            </div>
            <p className="mt-2 whitespace-pre-line text-sm text-slate-800">{c.body}</p>
          </li>
        ))}
      </ul>
      {list.items.length === 0 && !list.isLoading && <p className="text-sm text-slate-400">No comments yet.</p>}
      <LoadMore hasNextPage={!!list.hasNextPage} isFetchingNextPage={list.isFetchingNextPage} fetchNextPage={() => void list.fetchNextPage()} />
    </div>
  );
}
