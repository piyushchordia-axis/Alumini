import { createRealtimeClient, type RealtimeStatus } from "@illuminize/shared/realtime";
import { create } from "zustand";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";

/** The app's single live-updates connection (same origin as the API; the Vite proxy forwards /socket.io in dev). */
export const realtime = createRealtimeClient({
  baseUrl: import.meta.env.VITE_API_URL ?? "",
  getAccessToken: async () => useAuthStore.getState().accessToken,
  refresh: () => api.core.refresh(),
});

export const useRealtimeStatus = create<{ status: RealtimeStatus }>(() => ({ status: realtime.status }));
realtime.onStatus((status) => useRealtimeStatus.setState({ status }));

/** Polling stays as a fallback; it slows right down while live updates are connected. */
export function usePollInterval(): number {
  const connected = useRealtimeStatus((s) => s.status === "connected");
  return connected ? 300_000 : 60_000;
}
