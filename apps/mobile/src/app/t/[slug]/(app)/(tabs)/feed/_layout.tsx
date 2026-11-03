import { Stack } from "expo-router";
import { detailHeader, FeatureGate, useAppHeaderOptions } from "@/components/AppHeader";

/** What a screen opened straight from a link, a push or another tab goes back to, with `withAnchor` or on a cold start. */
export const unstable_settings = { anchor: "index" };

export default function FeedStack() {
  const appHeader = useAppHeaderOptions();
  return (
    <FeatureGate feature="feed">
      <Stack>
        <Stack.Screen name="index" options={appHeader} />
        <Stack.Screen name="[postId]" options={{ ...detailHeader, title: "Post" }} />
        <Stack.Screen name="digest" options={{ ...detailHeader, title: "This week" }} />
        <Stack.Screen name="new" options={{ ...detailHeader, title: "New post", presentation: "modal" }} />
        <Stack.Screen name="edit/[postId]" options={{ ...detailHeader, title: "Edit post", presentation: "modal" }} />
      </Stack>
    </FeatureGate>
  );
}
