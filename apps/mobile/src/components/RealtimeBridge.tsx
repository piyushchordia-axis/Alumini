import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { AppState } from "react-native";
import { qk } from "@/lib/queryKeys";
import { realtime } from "@/lib/realtime";
import { useAuthStore } from "@/stores/authStore";

/**
 * Live updates while the app is open and signed in: the bell count changes immediately and the notification list
 * refetches. The connection closes in the background (push notifications cover that) and reopens on return.
 */
export function RealtimeBridge() {
  const qc = useQueryClient();
  const hydrated = useAuthStore((s) => s.hydrated);
  const authed = useAuthStore((s) => s.isAuthenticated);
  const active = hydrated && authed;

  useEffect(() => {
    const offs = [
      realtime.on("notification:new", (e) => {
        qc.setQueryData(qk.unread(e.tenantSlug), { count: e.unreadCount });
        void qc.invalidateQueries({ queryKey: qk.notifications(e.tenantSlug), predicate: (q) => q.queryKey.length === 2 });
      }),
      realtime.on("notification:unread", (e) => qc.setQueryData(qk.unread(e.tenantSlug), { count: e.count })),
      // One notification sent to many members (an announcement): refetch rather than patch.
      realtime.on("notification:bulk", (e) => {
        void qc.invalidateQueries({ queryKey: ["notifications", e.tenantSlug] });
        if (e.type === "ANNOUNCEMENT") void qc.invalidateQueries({ queryKey: ["posts", e.tenantSlug] });
      }),
      realtime.onReconnect(() => void qc.invalidateQueries({ queryKey: ["notifications"] })),
    ];
    return () => offs.forEach((off) => off());
  }, [qc]);

  useEffect(() => {
    if (!active) {
      realtime.stop();
      return;
    }
    realtime.start();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        realtime.start();
        void qc.invalidateQueries({ queryKey: ["notifications"] });
      } else if (state === "background") realtime.stop();
    });
    return () => sub.remove();
  }, [active, qc]);

  return null;
}
