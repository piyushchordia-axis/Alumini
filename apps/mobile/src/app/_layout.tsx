import { isApiClientError } from "@illuminize/shared/client";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { PushNotificationsBridge } from "@/components/PushNotificationsBridge";
import { RealtimeBridge } from "@/components/RealtimeBridge";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { qk } from "@/lib/queryKeys";
import { useAuthStore } from "@/stores/authStore";
import { ThemeProvider } from "@/theme";

/**
 * Keeps the cached user and membership list fresh (qk.me, so screens can invalidate it after registering or
 * switching). Only an authentication failure signs the user out; starting the app offline keeps the session.
 */
function SessionSync() {
  const hydrated = useAuthStore((s) => s.hydrated);
  const authed = useAuthStore((s) => s.isAuthenticated);
  const setUser = useAuthStore((s) => s.setUser);
  const clear = useAuthStore((s) => s.clear);
  const me = useQuery({ queryKey: qk.me, queryFn: () => api.me.get(), enabled: hydrated && authed, staleTime: 60_000 });
  useEffect(() => {
    if (me.data) setUser(me.data.user, me.data.memberships);
  }, [me.data, setUser]);
  useEffect(() => {
    if (isApiClientError(me.error) && me.error.status === 401) clear();
  }, [me.error, clear]);
  return null;
}

/** Root providers. Tenant theming is applied in t/[slug]/_layout. */
export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <SessionSync />
        <RealtimeBridge />
        <PushNotificationsBridge />
        {/* Screens are light, so keep dark status-bar content even when the phone is in dark mode. */}
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false }} />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
