import { Stack } from "expo-router";
import { detailHeader, FeatureGate, useAppHeaderOptions } from "@/components/AppHeader";

export default function BusinessesStack() {
  const appHeader = useAppHeaderOptions();
  return (
    <FeatureGate feature="businesses">
      <Stack>
        <Stack.Screen name="index" options={appHeader} />
        <Stack.Screen name="[id]" options={{ ...detailHeader, title: "Business" }} />
        <Stack.Screen name="new" options={{ ...detailHeader, title: "Add a business", presentation: "modal" }} />
        <Stack.Screen name="edit/[id]" options={{ ...detailHeader, title: "Edit listing", presentation: "modal" }} />
      </Stack>
    </FeatureGate>
  );
}
