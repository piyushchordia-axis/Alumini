import { Stack } from "expo-router";
import { detailHeader, FeatureGate, useAppHeaderOptions } from "@/components/AppHeader";

/** What a screen opened straight from a link, a push or another tab goes back to, with `withAnchor` or on a cold start. */
export const unstable_settings = { anchor: "index" };

export default function FundingStack() {
  const appHeader = useAppHeaderOptions();
  return (
    <FeatureGate feature="funding">
      <Stack>
        <Stack.Screen name="index" options={appHeader} />
        <Stack.Screen name="[id]" options={{ ...detailHeader, title: "Funding" }} />
        <Stack.Screen name="new" options={{ ...detailHeader, title: "New listing", presentation: "modal" }} />
        <Stack.Screen name="edit/[id]" options={{ ...detailHeader, title: "Edit listing", presentation: "modal" }} />
      </Stack>
    </FeatureGate>
  );
}
