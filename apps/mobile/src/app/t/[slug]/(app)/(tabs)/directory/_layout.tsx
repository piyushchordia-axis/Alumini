import { Stack } from "expo-router";
import { FeatureGate } from "@/components/AppHeader";

export default function DirectoryStack() {
  return (
    <FeatureGate feature="directory">
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="[membershipId]" />
      </Stack>
    </FeatureGate>
  );
}
