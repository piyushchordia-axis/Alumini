import { createApiClient } from "@illuminize/shared/client";
import { useAuthStore } from "@/stores/authStore";
import { secureTokenStorage } from "./storage";

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");

export const api = createApiClient({
  baseUrl: API_URL,
  storage: secureTokenStorage,
  onUnauthorized: () => useAuthStore.getState().clear(),
});
