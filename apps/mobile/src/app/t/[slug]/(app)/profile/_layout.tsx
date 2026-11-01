import { Stack } from "expo-router";

export default function ProfileStack() {
  return (
    <Stack screenOptions={{ headerTitleStyle: { fontWeight: "700" } }}>
      <Stack.Screen name="index" options={{ title: "My profile" }} />
      <Stack.Screen name="edit" options={{ title: "Edit profile" }} />
      <Stack.Screen name="my-content" options={{ title: "My posts & listings" }} />
      <Stack.Screen name="notifications" options={{ title: "Notifications" }} />
      <Stack.Screen name="account" options={{ title: "Email & account" }} />
      <Stack.Screen name="notification-settings" options={{ title: "Notification settings" }} />
    </Stack>
  );
}
