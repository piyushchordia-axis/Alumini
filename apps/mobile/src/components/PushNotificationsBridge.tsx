import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect } from "react";
import { pushSupported } from "@/hooks/usePushRegistration";
import { api } from "@/lib/api";
import { notificationHref } from "@/lib/notificationLinks";
import { qk } from "@/lib/queryKeys";

/** Data the API attaches to every push (see ExpoPushChannel). */
interface PushData {
  tenantSlug?: string;
  type?: string;
  notificationId?: string;
  [key: string]: unknown;
}

/** Each tapped notification is handled once, even if the launch response is read again after a remount. */
const handled = new Set<string>();

/**
 * Shows notifications that arrive while the app is open, refreshes the bell count, and opens the right screen
 * (in the right institution) when a notification is tapped, including the tap that launched the app.
 */
export function PushNotificationsBridge() {
  const qc = useQueryClient();
  useEffect(() => {
    if (!pushSupported) return;
    let active = true;
    const subs: { remove: () => void }[] = [];

    const open = (id: string, data: PushData) => {
      if (handled.has(id)) return;
      handled.add(id);
      const slug = data.tenantSlug;
      if (!slug) return;
      if (data.notificationId) {
        api.notifications
          .markRead(slug, data.notificationId)
          .then(() => qc.invalidateQueries({ queryKey: qk.notifications(slug) }))
          .catch(() => undefined);
      }
      router.push(notificationHref(slug, data.type ?? "", data) ?? `/t/${slug}/profile/notifications`);
    };

    (async () => {
      const Notifications = await import("expo-notifications");
      if (!active) return;
      Notifications.setNotificationHandler({
        handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
      });
      subs.push(
        Notifications.addNotificationReceivedListener((n) => {
          const slug = (n.request.content.data as PushData | undefined)?.tenantSlug;
          if (slug) void qc.invalidateQueries({ queryKey: qk.notifications(slug) });
        }),
      );
      subs.push(
        Notifications.addNotificationResponseReceivedListener((r) => {
          open(r.notification.request.identifier, (r.notification.request.content.data ?? {}) as PushData);
        }),
      );
      const launch = await Notifications.getLastNotificationResponseAsync();
      if (active && launch) open(launch.notification.request.identifier, (launch.notification.request.content.data ?? {}) as PushData);
    })().catch(() => undefined);

    return () => {
      active = false;
      subs.forEach((s) => s.remove());
    };
  }, [qc]);
  return null;
}
