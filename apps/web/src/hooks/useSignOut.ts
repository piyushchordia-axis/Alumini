import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";

/**
 * Signs out in this browser, as the phone app's useSignOut does: revokes the session on the server when it can be
 * reached, and always clears the session and every cached answer, so whoever signs in next sees nothing of this
 * account. Then opens `to` in place of the page it was called from.
 */
export function useSignOut() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  return useCallback(
    async (to: string) => {
      try {
        await api.auth.logout(useAuthStore.getState().refreshToken);
      } catch {
        // The local session is cleared even when the server can't be reached.
      } finally {
        qc.clear();
        navigate(to, { replace: true });
      }
    },
    [navigate, qc],
  );
}
