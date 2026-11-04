import { Stack } from "expo-router";

/**
 * Finding mentors, requests and the member's own offer to mentor. A mentor's page and the request form sit above the tabs,
 * in (app)/mentors. No gate here: a member who can't use mentorship now can still leave what they're in from this screen,
 * which says so itself.
 */
export default function MentorsStack() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ headerShown: false }} />
    </Stack>
  );
}
