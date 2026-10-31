import { Stack } from "expo-router";
import { detailHeader, FeatureGate, useAppHeaderOptions } from "@/components/AppHeader";

export default function EventsStack() {
  const appHeader = useAppHeaderOptions();
  return (
    <FeatureGate feature="events">
      <Stack>
        <Stack.Screen name="index" options={appHeader} />
        <Stack.Screen name="[id]" options={{ ...detailHeader, title: "Event" }} />
        <Stack.Screen name="new" options={{ ...detailHeader, title: "Plan a gathering", presentation: "modal" }} />
        <Stack.Screen name="edit/[id]" options={{ ...detailHeader, title: "Edit event", presentation: "modal" }} />
      </Stack>
    </FeatureGate>
  );
}
