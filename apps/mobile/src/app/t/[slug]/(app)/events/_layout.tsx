import { Stack } from "expo-router";

export default function EventsStack() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[id]" options={{ headerShown: true, title: "Event", headerTitleStyle: { fontWeight: "700" } }} />
      <Stack.Screen name="new" options={{ headerShown: true, title: "Plan a gathering", presentation: "modal" }} />
    </Stack>
  );
}
