import { Stack } from "expo-router";
import { ChatGate } from "@/components/AppHeader";

/** The inbox. Threads, a new conversation and the blocked list sit above the tabs, in (app)/messages. */
export default function MessagesStack() {
  return (
    <ChatGate>
      <Stack>
        <Stack.Screen name="index" options={{ headerShown: false }} />
      </Stack>
    </ChatGate>
  );
}
