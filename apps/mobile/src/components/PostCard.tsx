import { REACTION_TYPES, type PostDto, type ReactionType } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import type { ComponentType } from "react";
import { Alert, Image, Pressable, Text, View } from "react-native";
import { IconAnnounce, IconCelebrate, IconComment, IconInsight, IconLike, IconLove, IconPin } from "@/components/icons";
import { MemberRow } from "@/components/MemberRow";
import { ModerationBadge, ModerationNote } from "@/components/ModerationBadge";
import { PollView } from "@/components/PollView";
import { ReportButton } from "@/components/ReportButton";
import { Badge, Body, Card, Muted, Row, toggleState } from "@/components/ui";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { colors, useTheme } from "@/theme";

const LABEL: Record<ReactionType, string> = { LIKE: "Like", LOVE: "Love", CELEBRATE: "Celebrate", INSIGHTFUL: "Insightful" };
const ICONS: Record<ReactionType, ComponentType<{ size?: number; color?: string }>> = {
  LIKE: IconLike,
  LOVE: IconLove,
  CELEBRATE: IconCelebrate,
  INSIGHTFUL: IconInsight,
};

export function PostCard({ slug, post, detail = false, onDeleted }: { slug: string; post: PostDto; detail?: boolean; onDeleted?: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const theme = useTheme();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["posts", slug] });
    void qc.invalidateQueries({ queryKey: ["post", slug, post.id] });
  };
  const react = useMutation({
    mutationFn: (type: ReactionType | null) => (type ? api.posts.reactions.set(slug, post.id, type) : api.posts.reactions.clear(slug, post.id)),
    onSuccess: invalidate,
    onError: (e) => Alert.alert("Could not react", errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => api.posts.remove(slug, post.id),
    onSuccess: () => {
      invalidate();
      onDeleted?.();
    },
    onError: (e) => Alert.alert("Could not delete", errorMessage(e)),
  });
  // A removed post's page 404s even for its author, and the API refuses edits, so its author can only delete it.
  const removed = post.moderationStatus === "REMOVED";
  const canOpen = !detail && !removed;
  return (
    <Card style={post.kind === "ANNOUNCEMENT" ? { borderLeftWidth: 4, borderLeftColor: theme.primary } : undefined}>
      <Row style={{ justifyContent: "space-between" }}>
        <MemberRow slug={slug} member={post.author} meta={`${timeAgo(post.createdAt)}${post.author.role === "TENANT_ADMIN" ? " · Admin" : ""}`} />
        <Row gap={6}>
          {post.kind === "ANNOUNCEMENT" && <Badge label="Announcement" tone="primary" />}
          {post.isPinned && <Badge label="Pinned" tone="primary" />}
          <ModerationBadge status={post.moderationStatus} />
        </Row>
      </Row>
      {(post.kind === "ANNOUNCEMENT" || post.isPinned) && (
        <Row gap={8}>
          {post.kind === "ANNOUNCEMENT" && <IconAnnounce size={14} color={theme.primary} />}
          {post.isPinned && <IconPin size={14} color={theme.primary} />}
        </Row>
      )}
      <ModerationNote status={post.moderationStatus} note={post.moderationNote} />
      <Pressable onPress={() => canOpen && router.push(`/t/${slug}/feed/${post.id}`)} disabled={!canOpen} accessibilityRole={canOpen ? "link" : undefined}>
        <Body>{post.body}</Body>
      </Pressable>
      {post.poll && <PollView slug={slug} postId={post.id} poll={post.poll} canVote={post.moderationStatus === "APPROVED"} />}
      {post.imageUrls.length > 0 && (
        <View style={{ gap: 6 }}>
          {post.imageUrls.map((u) => (
            <Image key={u} source={{ uri: u }} style={{ width: "100%", height: 220, borderRadius: 10 }} resizeMode="cover" accessibilityIgnoresInvertColors accessibilityLabel="Post image" />
          ))}
        </View>
      )}
      <Row style={{ justifyContent: "space-between", borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 }}>
        <Row gap={6}>
          <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: "#f8fafc", borderRadius: 999, borderWidth: 1, borderColor: colors.border, padding: 2 }}>
            {REACTION_TYPES.map((t) => {
              const Icon = ICONS[t];
              const active = post.myReaction === t;
              return (
                <Pressable
                  key={t}
                  disabled={post.moderationStatus !== "APPROVED"}
                  onPress={() => react.mutate(active ? null : t)}
                  accessibilityRole="button"
                  accessibilityLabel={LABEL[t]}
                  {...toggleState(active)}
                  aria-disabled={post.moderationStatus !== "APPROVED"}
                  hitSlop={4}
                  style={{ width: 36, height: 36, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: active ? "#fff" : "transparent" }}
                >
                  <Icon size={16} color={active ? theme.primary : colors.muted} />
                </Pressable>
              );
            })}
          </View>
          <Muted size={13}>{post.reactionCount}</Muted>
          <Pressable onPress={() => canOpen && router.push(`/t/${slug}/feed/${post.id}`)} disabled={!canOpen} style={{ marginLeft: 6, flexDirection: "row", alignItems: "center", gap: 4 }} accessibilityRole="button" accessibilityLabel={`${post.commentCount} comments`}>
            <IconComment size={14} color={colors.muted} />
            <Muted size={13}>{post.commentCount}</Muted>
          </Pressable>
        </Row>
        {post.isMine ? (
          <Row gap={14}>
            {!removed && (
              <Pressable onPress={() => router.push(`/t/${slug}/feed/edit/${post.id}`)} accessibilityRole="button" accessibilityLabel="Edit post" hitSlop={8}>
                <Text style={{ color: colors.faint, fontSize: 12 }}>Edit</Text>
              </Pressable>
            )}
            <Pressable onPress={() => Alert.alert("Delete post?", undefined, [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => remove.mutate() }])} accessibilityRole="button" accessibilityLabel="Delete post" hitSlop={8}>
              <Text style={{ color: colors.faint, fontSize: 12 }}>Delete</Text>
            </Pressable>
          </Row>
        ) : (
          <ReportButton slug={slug} contentType="POST" contentId={post.id} />
        )}
      </Row>
    </Card>
  );
}
