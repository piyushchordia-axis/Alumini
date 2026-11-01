import { MAX_POST_IMAGES, REACTION_TYPES, type PostDto, type ReactionType } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ImageUploader } from "@/components/common/ImageUploader";
import { MemberLink } from "@/components/common/MemberLink";
import { PollView } from "@/components/feed/PollView";
import { ModerationStatusBadge } from "@/components/moderation/ModerationStatusBadge";
import { ReportButton } from "@/components/moderation/ReportDialog";
import { Badge, Button, Card, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { toast } from "@/stores/uiStore";

const REACTION_EMOJI: Record<ReactionType, string> = { LIKE: "👍", LOVE: "❤️", CELEBRATE: "🎉", INSIGHTFUL: "💡" };
const REACTION_LABEL: Record<ReactionType, string> = { LIKE: "Like", LOVE: "Love", CELEBRATE: "Celebrate", INSIGHTFUL: "Insightful" };

export function PostCard({ slug, post, detail = false, onDeleted }: { slug: string; post: PostDto; detail?: boolean; onDeleted?: () => void }) {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["posts", slug] });
    void qc.invalidateQueries({ queryKey: ["post", slug, post.id] });
  };
  const react = useMutation({
    mutationFn: (type: ReactionType | null) => (type ? api.posts.reactions.set(slug, post.id, type) : api.posts.reactions.clear(slug, post.id)),
    onSuccess: invalidate,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post.body);
  const [draftImages, setDraftImages] = useState<string[]>(post.imageUrls);
  const save = useMutation({
    mutationFn: () => api.posts.update(slug, post.id, { body: draft.trim(), imageUrls: draftImages }),
    onSuccess: (updated) => {
      invalidate();
      setEditing(false);
      toast.success(updated.moderationStatus === "PENDING" ? "Saved — awaiting admin approval" : "Post updated");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const startEditing = () => {
    setDraft(post.body);
    setDraftImages(post.imageUrls);
    setEditing(true);
  };
  const remove = useMutation({
    mutationFn: () => api.posts.remove(slug, post.id),
    onSuccess: () => {
      invalidate();
      toast.success("Post deleted");
      onDeleted?.();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Card as="article" className="p-4">
      <div className="flex items-start justify-between gap-3">
        <MemberLink slug={slug} member={post.author} meta={`${timeAgo(post.createdAt)}${post.author.role === "TENANT_ADMIN" ? " · Admin" : ""}`} />
        <div className="flex items-center gap-2">
          {post.isPinned && <Badge tone="primary">📌 Pinned</Badge>}
          <ModerationStatusBadge status={post.moderationStatus} note={post.moderationNote} />
        </div>
      </div>
      {editing ? (
        <div className="mt-3 space-y-3">
          <Textarea aria-label="Edit post" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={5000} rows={4} autoFocus />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ImageUploader slug={slug} urls={draftImages} onChange={setDraftImages} max={MAX_POST_IMAGES} />
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => save.mutate()} loading={save.isPending} disabled={!draft.trim()}>
                Save
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <p className="mt-3 whitespace-pre-line text-[15px] leading-relaxed text-slate-800">{post.body}</p>
      )}
      {post.poll && <PollView slug={slug} postId={post.id} poll={post.poll} canVote={post.moderationStatus === "APPROVED"} />}
      {!editing && post.imageUrls.length > 0 && (
        <div className={`mt-3 grid gap-2 ${post.imageUrls.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
          {post.imageUrls.map((u) => (
            <a key={u} href={u} target="_blank" rel="noreferrer">
              <img src={u} alt="" className="max-h-96 w-full rounded-lg object-cover" loading="lazy" />
            </a>
          ))}
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-sm text-slate-500">
        {REACTION_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            disabled={post.moderationStatus !== "APPROVED"}
            onClick={() => react.mutate(post.myReaction === t ? null : t)}
            className={`rounded-full px-2 py-1 transition hover:bg-slate-100 ${post.myReaction === t ? "bg-primary/10 ring-1 ring-primary/30" : ""}`}
            aria-label={REACTION_LABEL[t]}
            aria-pressed={post.myReaction === t}
          >
            {REACTION_EMOJI[t]}
          </button>
        ))}
        <span className="ml-1">{post.reactionCount}</span>
        {detail ? (
          <span className="ml-3">💬 {post.commentCount}</span>
        ) : (
          <Link to={`/t/${slug}/app/feed/${post.id}`} className="ml-3 hover:text-slate-800">
            💬 {post.commentCount} {post.commentCount === 1 ? "comment" : "comments"}
          </Link>
        )}
        <span className="ml-auto flex items-center gap-3">
          {post.isMine ? (
            <>
              {!editing && (
                <button type="button" className="text-xs text-slate-400 hover:text-slate-700" onClick={startEditing}>
                  Edit
                </button>
              )}
              <button type="button" className="text-xs text-slate-400 hover:text-red-600" onClick={() => confirm("Delete this post?") && remove.mutate()}>
                Delete
              </button>
            </>
          ) : (
            <ReportButton slug={slug} contentType="POST" contentId={post.id} />
          )}
        </span>
      </div>
    </Card>
  );
}
