import { Stack } from "expo-router";

export default function DirectoryStack() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[membershipId]" options={{ headerShown: true, title: "Member", headerTitleStyle: { fontWeight: "700" } }} />
    </Stack>
  );
}
