import { createApiClient, type TokenStorage } from "@illuminize/shared/client";
import { useAuthStore } from "@/stores/authStore";

const storage: TokenStorage = {
  async getAccessToken() {
    return useAuthStore.getState().accessToken;
  },
  async getRefreshToken() {
    return useAuthStore.getState().refreshToken;
  },
  async setTokens(tokens) {
    useAuthStore.getState().setTokens(tokens);
  },
  async clear() {
    useAuthStore.getState().clear();
  },
};

export const api = createApiClient({
  baseUrl: import.meta.env.VITE_API_URL ?? "",
  storage,
  onUnauthorized: () => useAuthStore.getState().clear(),
});
