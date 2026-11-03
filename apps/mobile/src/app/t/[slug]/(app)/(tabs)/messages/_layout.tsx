import { Stack } from "expo-router";
import { ChatGate, useAppHeaderOptions } from "@/components/AppHeader";

/** The inbox. Threads, a new conversation and the blocked list sit above the tabs, in (app)/messages. */
export default function MessagesStack() {
  const appHeader = useAppHeaderOptions();
  return (
    <ChatGate>
      <Stack>
        <Stack.Screen name="index" options={appHeader} />
      </Stack>
    </ChatGate>
  );
}
