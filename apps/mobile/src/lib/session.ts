import { useQueryClient } from "@tanstack/react-query";
import { useRouter, type Href } from "expo-router";
import { useCallback } from "react";
import { api } from "@/lib/api";
import { getRegisteredPushToken, setRegisteredPushToken } from "@/lib/push";
import { realtime } from "@/lib/realtime";
import { secureTokenStorage } from "@/lib/storage";
import { useAuthStore } from "@/stores/authStore";
import { useTenantStore } from "@/stores/tenantStore";

/**
 * Signs out on this device: unregisters the push token (so the next person to use the phone does not get this
 * user's notifications), revokes the session on the server when reachable, and always clears local state.
 */
export function useSignOut() {
  const router = useRouter();
  const qc = useQueryClient();
  const clear = useAuthStore((s) => s.clear);
  return useCallback(
    async (to: Href = "/") => {
      try {
        const token = await getRegisteredPushToken();
        if (token) await api.me.removePushToken(token).catch(() => undefined);
        await api.auth.logout(await secureTokenStorage.getRefreshToken()).catch(() => undefined);
      } finally {
        realtime.stop();
        await setRegisteredPushToken(null);
        await secureTokenStorage.clear().catch(() => undefined);
        clear();
        qc.clear();
        router.replace(to);
      }
    },
    [clear, qc, router],
  );
}

/** Deletes the account on the server, then clears everything local. Throws if the server call fails. */
export function useDeleteAccount() {
  const router = useRouter();
  const qc = useQueryClient();
  const clear = useAuthStore((s) => s.clear);
  const setLast = useTenantStore((s) => s.setLastTenantSlug);
  return useCallback(async () => {
    await api.me.deleteAccount();
    await setRegisteredPushToken(null);
    clear();
    setLast(null);
    qc.clear();
    router.replace("/");
  }, [clear, qc, router, setLast]);
}
