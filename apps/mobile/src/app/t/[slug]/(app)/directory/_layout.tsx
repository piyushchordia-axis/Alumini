import { Stack } from "expo-router";
import { detailHeader, FeatureGate, useAppHeaderOptions } from "@/components/AppHeader";

export default function DirectoryStack() {
  const appHeader = useAppHeaderOptions();
  return (
    <FeatureGate feature="directory">
      <Stack>
        <Stack.Screen name="index" options={appHeader} />
        <Stack.Screen name="[membershipId]" options={{ ...detailHeader, title: "Member" }} />
      </Stack>
    </FeatureGate>
  );
}
