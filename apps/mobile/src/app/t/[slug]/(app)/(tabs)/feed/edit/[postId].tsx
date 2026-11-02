import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Alert } from "react-native";
import { PostForm } from "@/components/forms/PostForm";
import { LoadError, Screen, Spinner } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

export default function EditPostScreen() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const { postId = "" } = useLocalSearchParams<{ postId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const post = useQuery({ queryKey: qk.post(slug, postId), queryFn: () => api.posts.get(slug, postId) });
  if (post.isLoading) return <Spinner />;
  if (post.error || !post.data) return <LoadError error={post.error ?? "Not found"} onRetry={() => void post.refetch()} onBack={() => router.back()} backLabel="Back" />;
  return (
    <Screen>
      <PostForm
        slug={slug}
        placeholder="Edit your post"
        initial={post.data}
        submitLabel="Save changes"
        onSubmit={async (input) => {
          const updated = await api.posts.update(slug, postId, input);
          qc.setQueryData(qk.post(slug, postId), updated);
          void qc.invalidateQueries({ queryKey: ["posts", slug] });
          if (updated.moderationStatus === "PENDING") Alert.alert("Saved — awaiting admin approval");
          router.back();
        }}
      />
    </Screen>
  );
}
