import { mentorshipKeys } from "@illuminize/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { chatSync } from "@/lib/chat";
import { qk } from "@/lib/queryKeys";
import { realtime } from "@/lib/realtime";
import { useIsAuthenticated } from "@/stores/authStore";

/** Notifications that tell an admin there is something to review. */
const ADMIN_TYPES = new Set(["NEW_MEMBER_PENDING", "CONTENT_PENDING", "REPORT_FILED", "CHAT_REPORT_FILED"]);

/**
 * Keeps the live connection open while signed in and turns live events into cache updates: the bell count changes
 * immediately and lists refetch, with no page reload.
 */
export function RealtimeBridge() {
  const qc = useQueryClient();
  const authed = useIsAuthenticated();

  useEffect(() => {
    const offs = [
      realtime.on("notification:new", (e) => {
        qc.setQueryData(qk.unread(e.tenantSlug), { count: e.unreadCount });
        void qc.invalidateQueries({ queryKey: qk.notifications(e.tenantSlug), predicate: (q) => q.queryKey.length === 2 });
        if (ADMIN_TYPES.has(e.notification.type)) void qc.invalidateQueries({ queryKey: ["admin", e.tenantSlug] });
        if (e.notification.type === "CELEBRATION_WISH") void qc.invalidateQueries({ queryKey: ["celebrations", e.tenantSlug] });
      }),
      // A request or mentorship changed, on either side, notified or not (a withdrawal tells nobody): lists and pages refetch.
      realtime.on("mentorship:changed", (e) => void qc.invalidateQueries({ queryKey: mentorshipKeys.all(e.tenantSlug) })),
      realtime.on("notification:unread", (e) => {
        qc.setQueryData(qk.unread(e.tenantSlug), { count: e.count });
      }),
      // One notification sent to many members (an announcement): refetch rather than patch.
      realtime.on("notification:bulk", (e) => {
        void qc.invalidateQueries({ queryKey: ["notifications", e.tenantSlug] });
        if (e.type === "ANNOUNCEMENT") void qc.invalidateQueries({ queryKey: ["posts", e.tenantSlug] });
      }),
      // Catch up on anything missed while disconnected.
      realtime.onReconnect(() => {
        void qc.invalidateQueries({ queryKey: ["notifications"] });
        void qc.invalidateQueries({ queryKey: ["mentorship"] });
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [qc]);

  useEffect(() => chatSync.attach(), []);

  useEffect(() => {
    if (authed) realtime.start();
    else realtime.stop();
  }, [authed]);

  return null;
}
