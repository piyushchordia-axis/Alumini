import { Stack } from "expo-router";
import { FeatureGate } from "@/components/AppHeader";

/** What a screen opened straight from a link, a push or another tab goes back to, with `withAnchor` or on a cold start. */
export const unstable_settings = { anchor: "index" };

export default function FeedStack() {
  return (
    <FeatureGate feature="feed">
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="[postId]" />
        <Stack.Screen name="digest" />
        <Stack.Screen name="new" options={{ presentation: "modal" }} />
        <Stack.Screen name="edit/[postId]" options={{ presentation: "modal" }} />
      </Stack>
    </FeatureGate>
  );
}
