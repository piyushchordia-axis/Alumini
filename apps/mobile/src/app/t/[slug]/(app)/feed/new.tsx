import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Alert } from "react-native";
import { PostForm } from "@/components/forms/PostForm";
import { Screen } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";

export default function NewPostScreen() {
  const { tenant, isTenantAdmin } = useMembership();
  const router = useRouter();
  const qc = useQueryClient();
  return (
    <Screen>
      <PostForm
        slug={tenant.slug}
        placeholder={`Share something with ${tenant.shortName ?? "the network"}…`}
        submitLabel="Post"
        note={isTenantAdmin ? undefined : "Posts are subject to this institution's moderation settings."}
        onSubmit={async (input) => {
          const post = await api.posts.create(tenant.slug, input);
          void qc.invalidateQueries({ queryKey: ["posts", tenant.slug] });
          Alert.alert(post.moderationStatus === "PENDING" ? "Posted — awaiting admin approval" : "Posted!");
          router.back();
        }}
      />
    </Screen>
  );
}
