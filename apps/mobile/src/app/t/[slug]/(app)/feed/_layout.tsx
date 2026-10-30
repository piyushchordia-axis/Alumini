import { Stack } from "expo-router";

export default function FeedStack() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[postId]" options={{ headerShown: true, title: "Post", headerTitleStyle: { fontWeight: "700" } }} />
      <Stack.Screen name="new" options={{ headerShown: true, title: "New post", presentation: "modal" }} />
    </Stack>
  );
}
