import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { useAuthStore } from "@/stores/authStore";
import { ThemeProvider } from "@/theme";

/** Root providers. Tenant theming is applied in t/[slug]/_layout. */
export default function RootLayout() {
  const hydrated = useAuthStore((s) => s.hydrated);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const setUser = useAuthStore((s) => s.setUser);
  const clear = useAuthStore((s) => s.clear);

  // Refresh the cached user/memberships whenever the app starts with a session.
  useEffect(() => {
    if (!hydrated || !isAuthenticated) return;
    api.me
      .get()
      .then((me) => setUser(me.user, me.memberships))
      .catch(() => clear());
  }, [hydrated, isAuthenticated, setUser, clear]);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false }} />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
