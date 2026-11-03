import { Stack } from "expo-router";
import { detailHeader, FeatureGate, useAppHeaderOptions } from "@/components/AppHeader";

/** What a screen opened straight from a link, a push or another tab goes back to, with `withAnchor` or on a cold start. */
export const unstable_settings = { anchor: "index" };

export default function JobsStack() {
  const appHeader = useAppHeaderOptions();
  return (
    <FeatureGate feature="jobs">
      <Stack>
        <Stack.Screen name="index" options={appHeader} />
        <Stack.Screen name="[jobId]" options={{ ...detailHeader, title: "Job" }} />
        <Stack.Screen name="new" options={{ ...detailHeader, title: "Post a job", presentation: "modal" }} />
        <Stack.Screen name="edit/[jobId]" options={{ ...detailHeader, title: "Edit job", presentation: "modal" }} />
        <Stack.Screen name="seeker" options={{ ...detailHeader, title: "Looking for work", presentation: "modal" }} />
      </Stack>
    </FeatureGate>
  );
}
