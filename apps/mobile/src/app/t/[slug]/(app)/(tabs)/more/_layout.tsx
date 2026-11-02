import { Stack } from "expo-router";
import { useAppHeaderOptions } from "@/components/AppHeader";

export default function MoreStack() {
  const appHeader = useAppHeaderOptions();
  return (
    <Stack>
      <Stack.Screen name="index" options={appHeader} />
    </Stack>
  );
}
