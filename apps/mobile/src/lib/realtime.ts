import { createRealtimeClient, type RealtimeStatus } from "@illuminize/shared/realtime";
import { create } from "zustand";
import { api, API_URL } from "@/lib/api";
import { secureTokenStorage } from "@/lib/storage";

/** The app's live-updates connection to the API (WebSocket; needs the API port reachable, e.g. public in Codespaces). */
export const realtime = createRealtimeClient({
  baseUrl: API_URL,
  getAccessToken: () => secureTokenStorage.getAccessToken(),
  refresh: () => api.core.refresh(),
});

export const useRealtimeStatus = create<{ status: RealtimeStatus }>(() => ({ status: realtime.status }));
realtime.onStatus((status) => useRealtimeStatus.setState({ status }));

/** Polling stays as a fallback; it slows right down while live updates are connected. */
export function usePollInterval(): number {
  const connected = useRealtimeStatus((s) => s.status === "connected");
  return connected ? 300_000 : 60_000;
}
