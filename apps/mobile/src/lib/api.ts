import { createApiClient } from "@illuminize/shared/client";
import { queryClient } from "@/lib/queryClient";
import { useAuthStore } from "@/stores/authStore";
import { secureTokenStorage } from "./storage";

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");

export const api = createApiClient({
  baseUrl: API_URL,
  storage: secureTokenStorage,
  // The next person to sign in here must not see this member's cached data, which a failed refetch would otherwise leave on screen.
  onUnauthorized: () => {
    useAuthStore.getState().clear();
    queryClient.clear();
  },
});
