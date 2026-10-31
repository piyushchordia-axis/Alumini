import { Stack } from "expo-router";
import { detailHeader, FeatureGate, useAppHeaderOptions } from "@/components/AppHeader";

export default function FeedStack() {
  const appHeader = useAppHeaderOptions();
  return (
    <FeatureGate feature="feed">
      <Stack>
        <Stack.Screen name="index" options={appHeader} />
        <Stack.Screen name="[postId]" options={{ ...detailHeader, title: "Post" }} />
        <Stack.Screen name="new" options={{ ...detailHeader, title: "New post", presentation: "modal" }} />
        <Stack.Screen name="edit/[postId]" options={{ ...detailHeader, title: "Edit post", presentation: "modal" }} />
      </Stack>
    </FeatureGate>
  );
}
