import { Stack } from "expo-router";
import { FeatureGate } from "@/components/AppHeader";

/** What a screen opened straight from a link, a push or another tab goes back to, with `withAnchor` or on a cold start. */
export const unstable_settings = { anchor: "index" };

export default function JobsStack() {
  return (
    <FeatureGate feature="jobs">
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="[jobId]" />
        <Stack.Screen name="new" options={{ presentation: "modal" }} />
        <Stack.Screen name="edit/[jobId]" options={{ presentation: "modal" }} />
        <Stack.Screen name="seeker" options={{ presentation: "modal" }} />
        {/* Pushed above the job it's about, which is what Back returns to; opened cold, the Jobs list is under it. */}
        <Stack.Screen name="request-referral/[jobId]" />
      </Stack>
    </FeatureGate>
  );
}
