import { Stack } from "expo-router";

/** What a screen opened straight from another tab goes back to, with `withAnchor`. */
export const unstable_settings = { anchor: "index" };

/** Native headers float over content on device; each screen draws StackHeader / Screen title instead. */
export default function ProfileStack() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="edit" />
      <Stack.Screen name="my-content" />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="account" />
      <Stack.Screen name="notification-settings" />
    </Stack>
  );
}
