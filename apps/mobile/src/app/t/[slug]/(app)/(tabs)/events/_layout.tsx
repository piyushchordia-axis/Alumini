import { Stack } from "expo-router";
import { FeatureGate } from "@/components/AppHeader";

/** What a screen opened straight from a link, a push or another tab goes back to, with `withAnchor` or on a cold start. */
export const unstable_settings = { anchor: "index" };

export default function EventsStack() {
  return (
    <FeatureGate feature="events">
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="[id]" />
        <Stack.Screen name="new" options={{ presentation: "modal" }} />
        <Stack.Screen name="edit/[id]" options={{ presentation: "modal" }} />
      </Stack>
    </FeatureGate>
  );
}
