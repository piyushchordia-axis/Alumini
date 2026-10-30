import { Stack } from "expo-router";

export default function FundingStack() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[id]" options={{ headerShown: true, title: "Funding", headerTitleStyle: { fontWeight: "700" } }} />
      <Stack.Screen name="new" options={{ headerShown: true, title: "New listing", presentation: "modal" }} />
    </Stack>
  );
}
