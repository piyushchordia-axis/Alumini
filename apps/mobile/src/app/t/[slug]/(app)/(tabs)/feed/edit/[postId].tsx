import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Alert } from "react-native";
import { PostForm } from "@/components/forms/PostForm";
import { loadingScreen } from "@/components/LoadingScreen";
import { Screen } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { usePageQuery } from "@/hooks/usePageQuery";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

export default function EditPostScreen() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const { postId = "" } = useLocalSearchParams<{ postId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const post = useQuery({ queryKey: qk.post(slug, postId), queryFn: () => api.posts.get(slug, postId) });
  const page = usePageQuery(post);
  // Only with nothing to show: a refetch failing in the background keeps the form and what was typed.
  if (!post.data) return loadingScreen({ title: "Edit post", shape: "form", page });
  return (
    <Screen title="Edit post">
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
