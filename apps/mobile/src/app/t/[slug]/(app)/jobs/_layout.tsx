import { Stack } from "expo-router";

export default function JobsStack() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[jobId]" options={{ headerShown: true, title: "Job", headerTitleStyle: { fontWeight: "700" } }} />
      <Stack.Screen name="new" options={{ headerShown: true, title: "Post a job", presentation: "modal" }} />
      <Stack.Screen name="seeker" options={{ headerShown: true, title: "Looking for work", presentation: "modal" }} />
    </Stack>
  );
}
