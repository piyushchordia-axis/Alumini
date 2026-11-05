import { MAX_POST_IMAGES, REACTION_TYPES, type PostDto, type ReactionType } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useState, type ComponentType } from "react";
import { Link } from "react-router-dom";
import { ImageUploader } from "@/components/common/ImageUploader";
import { MemberLink } from "@/components/common/MemberLink";
import { PollView } from "@/components/feed/PollView";
import { IconAnnounce, IconCelebrate, IconComment, IconInsight, IconLike, IconLove, IconPin, type IconProps } from "@/components/icons";
import { ModerationStatusBadge } from "@/components/moderation/ModerationStatusBadge";
import { ReportButton } from "@/components/moderation/ReportDialog";
import { Badge, Button, Card, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { toast } from "@/stores/uiStore";

const REACTION_LABEL: Record<ReactionType, string> = { LIKE: "Like", LOVE: "Love", CELEBRATE: "Celebrate", INSIGHTFUL: "Insightful" };
const REACTION_ICON: Record<ReactionType, ComponentType<IconProps>> = {
  LIKE: IconLike,
  LOVE: IconLove,
  CELEBRATE: IconCelebrate,
  INSIGHTFUL: IconInsight,
};

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
  // A removed post's page 404s even for its author, and the API refuses edits, so its author can only delete it.
  const removed = post.moderationStatus === "REMOVED";

  return (
    <Card as="article" elevation={1} className={post.kind === "ANNOUNCEMENT" ? "border-l-4 border-l-primary p-4" : "p-4"}>
      <div className="flex items-start justify-between gap-3">
        <MemberLink slug={slug} member={post.author} meta={`${timeAgo(post.createdAt)}${post.author.role === "TENANT_ADMIN" ? " · Admin" : ""}`} />
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {post.kind === "ANNOUNCEMENT" && (
            <Badge tone="primary" className="gap-1">
              <IconAnnounce size={12} /> Announcement
            </Badge>
          )}
          {post.isPinned && (
            <Badge tone="primary" className="gap-1">
              <IconPin size={12} /> Pinned
            </Badge>
          )}
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
      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3 text-sm text-slate-500">
        <div className="flex items-center gap-0.5 rounded-full bg-slate-100/70 p-0.5 ring-1 ring-slate-200">
          {REACTION_TYPES.map((t) => {
            const Icon = REACTION_ICON[t];
            const active = post.myReaction === t;
            return (
              <button
                key={t}
                type="button"
                disabled={post.moderationStatus !== "APPROVED"}
                onClick={() => react.mutate(active ? null : t)}
                // Hover lives only on the unchosen chips: on a chosen one it outranked the brand ink and left the
                // pointer resting on a near-black icon after the click. The wash and ring are brandTones', as on the
                // phone: a pale brand's own tint (bg-primary/14) vanished into the tray.
                className={clsx(
                  "inline-flex h-9 w-9 items-center justify-center rounded-full transition duration-[var(--duration-fast)] focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40 motion-safe:active:scale-90 pointer-coarse:h-10 pointer-coarse:w-10",
                  active ? "bg-primary-wash text-primary-ink ring-1 ring-primary-ring ring-inset" : "text-slate-500 enabled:hover:bg-white enabled:hover:text-slate-700 enabled:hover:shadow-sm",
                )}
                aria-label={REACTION_LABEL[t]}
                aria-pressed={active}
                title={REACTION_LABEL[t]}
              >
                <Icon size={18} fill={active ? "currentColor" : "none"} fillOpacity={active ? 0.22 : undefined} strokeWidth={active ? 2 : 1.75} />
              </button>
            );
          })}
        </div>
        <span className={clsx("tabular-nums text-xs", post.myReaction ? "font-semibold text-primary-ink" : "text-slate-500")}>{post.reactionCount}</span>
        <div className="mx-1 hidden h-4 w-px bg-slate-200 sm:block" aria-hidden />
        {detail || removed ? (
          <span className="inline-flex items-center gap-1.5 text-xs">
            <IconComment size={14} /> {post.commentCount}
          </span>
        ) : (
          <Link to={`/t/${slug}/app/feed/${post.id}`} className="inline-flex items-center gap-1.5 text-xs hover:text-slate-800">
            <IconComment size={14} />
            {post.commentCount} {post.commentCount === 1 ? "comment" : "comments"}
          </Link>
        )}
        <span className="ml-auto flex items-center gap-3">
          {post.isMine ? (
            <>
              {!editing && !removed && (
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
