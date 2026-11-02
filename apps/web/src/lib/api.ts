import { createApiClient, type TokenStorage } from "@illuminize/shared/client";
import { queryClient } from "@/lib/queryClient";
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
  // The next person to sign in here must not see this member's cached data, which a failed refetch would otherwise leave on screen.
  onUnauthorized: () => {
    useAuthStore.getState().clear();
    queryClient.clear();
  },
});
