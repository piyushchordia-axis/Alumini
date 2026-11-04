import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, Text, View } from "react-native";
import { MemberRow } from "@/components/MemberRow";
import { PostCard } from "@/components/PostCard";
import { ReportButton } from "@/components/ReportButton";
import { Button, Input, ListEmpty, LoadError, Muted, Row, Spinner, StackScreen } from "@/components/ui";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { qk } from "@/lib/queryKeys";
import { colors, spacing } from "@/theme";

export default function PostDetailScreen() {
  const { tenant, isTenantAdmin } = useMembership();
  const slug = tenant.slug;
  const { postId = "" } = useLocalSearchParams<{ postId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const post = useQuery({ queryKey: qk.post(slug, postId), queryFn: () => api.posts.get(slug, postId) });
  const comments = useInfiniteList(qk.comments(slug, postId), (cursor) => api.posts.comments.list(slug, postId, { cursor, limit: 20 }), !!post.data);
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
    onError: (e) => Alert.alert("Could not comment", errorMessage(e)),
  });
  const remove = useMutation({ mutationFn: (id: string) => api.posts.comments.remove(slug, postId, id), onSuccess: invalidate, onError: (e) => Alert.alert("Could not delete", errorMessage(e)) });
  if (post.isLoading)
    return (
      <StackScreen title="Post">
        <Spinner />
      </StackScreen>
    );
  if (post.error || !post.data)
    return (
      <StackScreen title="Post">
        <LoadError error={post.error ?? "Not found"} onRetry={() => void post.refetch()} onBack={() => router.back()} backLabel="Back" />
      </StackScreen>
    );
  const canComment = post.data.moderationStatus === "APPROVED";
  return (
    <StackScreen title="Post">
      {/* In-tree StackHeader is above this view, so the keyboard offset is zero. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={0}>
        <FlatList
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          data={comments.items}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
          onEndReached={comments.loadMore}
          ListHeaderComponent={
            <View style={{ gap: spacing.md, marginBottom: spacing.sm }}>
              <PostCard slug={slug} post={post.data} detail onDeleted={() => router.back()} />
              <Text style={{ fontWeight: "700", color: colors.text }}>
                Comments
              </Text>
            </View>
          }
          ListEmptyComponent={
            <ListEmpty loading={comments.isLoading} error={comments.error} onRetry={() => void comments.refetch()}>
              <Muted>No comments yet.</Muted>
            </ListEmpty>
          }
          renderItem={({ item: c }) => (
            <View style={{ backgroundColor: "#fff", borderRadius: 12, padding: 12, gap: 6, borderWidth: 1, borderColor: colors.border }}>
              <Row style={{ justifyContent: "space-between" }}>
                <MemberRow slug={slug} member={c.author} meta={timeAgo(c.createdAt)} size={28} />
                {c.isMine || isTenantAdmin ? (
                  <Pressable accessibilityRole="button" accessibilityLabel="Delete comment" hitSlop={8} onPress={() => Alert.alert("Delete comment?", undefined, [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => remove.mutate(c.id) }])}>
                    <Muted>Delete</Muted>
                  </Pressable>
                ) : (
                  <ReportButton slug={slug} contentType="COMMENT" contentId={c.id} />
                )}
              </Row>
              <Text style={{ color: "#1e293b", lineHeight: 20 }}>{c.body}</Text>
            </View>
          )}
        />
        {canComment && (
          <View style={{ flexDirection: "row", gap: 8, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: "#fff" }}>
            <View style={{ flex: 1 }}>
              <Input accessibilityLabel="Write a comment" placeholder="Write a comment…" value={body} onChangeText={setBody} maxLength={2000} />
            </View>
            <Button title="Reply" onPress={() => add.mutate()} loading={add.isPending} disabled={!body.trim()} />
          </View>
        )}
      </KeyboardAvoidingView>
    </StackScreen>
  );
}
