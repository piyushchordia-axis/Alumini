import { REACTION_TYPES, type PostDto, type ReactionType } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Alert, Image, Pressable, Text, View } from "react-native";
import { PollView } from "@/components/PollView";
import { MemberRow } from "@/components/MemberRow";
import { ModerationBadge, ModerationNote } from "@/components/ModerationBadge";
import { ReportButton } from "@/components/ReportButton";
import { Badge, Body, Card, Muted, Row } from "@/components/ui";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { colors, useTheme } from "@/theme";

const EMOJI: Record<ReactionType, string> = { LIKE: "👍", LOVE: "❤️", CELEBRATE: "🎉", INSIGHTFUL: "💡" };
const LABEL: Record<ReactionType, string> = { LIKE: "Like", LOVE: "Love", CELEBRATE: "Celebrate", INSIGHTFUL: "Insightful" };

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
  return (
    <Card>
      <Row style={{ justifyContent: "space-between" }}>
        <MemberRow slug={slug} member={post.author} meta={`${timeAgo(post.createdAt)}${post.author.role === "TENANT_ADMIN" ? " · Admin" : ""}`} />
        {post.isPinned && <Badge label="📌 Pinned" tone="primary" />}
        <ModerationBadge status={post.moderationStatus} />
      </Row>
      <ModerationNote status={post.moderationStatus} note={post.moderationNote} />
      <Pressable onPress={() => !detail && router.push(`/t/${slug}/feed/${post.id}`)} disabled={detail} accessibilityRole={detail ? undefined : "link"}>
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
        <Row gap={4}>
          {REACTION_TYPES.map((t) => (
            <Pressable
              key={t}
              disabled={post.moderationStatus !== "APPROVED"}
              onPress={() => react.mutate(post.myReaction === t ? null : t)}
              accessibilityRole="button"
              accessibilityLabel={LABEL[t]}
              accessibilityState={{ selected: post.myReaction === t, disabled: post.moderationStatus !== "APPROVED" }}
              hitSlop={4}
              style={{ padding: 6, borderRadius: 999, backgroundColor: post.myReaction === t ? theme.primarySoft : "transparent" }}>
              <Text style={{ fontSize: 16 }}>{EMOJI[t]}</Text>
            </Pressable>
          ))}
          <Muted size={13}>{post.reactionCount}</Muted>
          <Pressable onPress={() => !detail && router.push(`/t/${slug}/feed/${post.id}`)} style={{ marginLeft: 10 }} accessibilityRole="button" accessibilityLabel={`${post.commentCount} comments`}>
            <Muted size={13}>💬 {post.commentCount}</Muted>
          </Pressable>
        </Row>
        {post.isMine ? (
          <Row gap={14}>
            <Pressable onPress={() => router.push(`/t/${slug}/feed/edit/${post.id}`)} accessibilityRole="button" accessibilityLabel="Edit post" hitSlop={8}>
              <Text style={{ color: colors.faint, fontSize: 12 }}>Edit</Text>
            </Pressable>
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
