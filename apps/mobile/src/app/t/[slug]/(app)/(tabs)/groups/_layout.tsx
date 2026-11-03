import { Stack } from "expo-router";
import { GroupsGate, useAppHeaderOptions } from "@/components/AppHeader";

/** Finding groups and answering invitations. A group's details, creating one and its thread sit above the tabs, in (app)/groups and (app)/messages. */
export default function GroupsStack() {
  const appHeader = useAppHeaderOptions();
  return (
    <GroupsGate>
      <Stack>
        <Stack.Screen name="index" options={appHeader} />
      </Stack>
    </GroupsGate>
  );
}
