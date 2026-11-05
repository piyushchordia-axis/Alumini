import { isAdminNotification, mentorshipKeys, type MembershipDto } from "@illuminize/shared";
import { activeChat, chatKeys } from "@illuminize/shared/chat";
import { useQueryClient } from "@tanstack/react-query";
import { router, usePathname } from "expo-router";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { pushSupported } from "@/hooks/usePushRegistration";
import { isPushAdminOf, opensInPlace } from "@/lib/admin";
import { api } from "@/lib/api";
import { MENTORSHIP_TYPES } from "@/lib/mentors";
import { notificationHref } from "@/lib/notificationLinks";
import { qk } from "@/lib/queryKeys";
import { REFERRAL_TYPES, refreshReferrals } from "@/lib/referrals";
import { useAuthStore } from "@/stores/authStore";
import { useChatStore } from "@/stores/chatStore";

/** Data the API attaches to every push (see ExpoPushChannel). Chat pushes carry `conversationId` and no `notificationId`. */
interface PushData {
  tenantSlug?: string;
  type?: string;
  notificationId?: string;
  conversationId?: string;
  [key: string]: unknown;
}

/** Each tapped notification is handled once, even if the launch response is read again after a remount. */
const handled = new Set<string>();

const SHOW = { shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false };
const HIDE = { shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false };

/** The thread on screen is the one this push is about, whether or not the app is in front. */
function isOpenThread(data: PushData): boolean {
  // An invitation is to a group the member isn't in yet, so it's news even with that group's thread on screen saying so.
  if (data.type === "CHAT_GROUP_INVITE") return false;
  const active = activeChat(useChatStore.getState().focus);
  return !!data.conversationId && data.conversationId === active?.conversationId && data.tenantSlug === active.slug;
}

/** A push about the thread already on screen tells the member nothing: they're reading it. */
const isForOpenThread = (data: PushData) => isOpenThread(data) && AppState.currentState === "active";

type StoredSession = Pick<ReturnType<typeof useAuthStore.getState>, "user" | "memberships">;

/** The signed-in session once it has been read back from the phone's storage, which a push that opens the app cold can beat. */
function storedSession(): Promise<StoredSession> {
  return new Promise((resolve) => {
    const now = useAuthStore.getState();
    if (now.hydrated) {
      resolve(now);
      return;
    }
    const off = useAuthStore.subscribe((s) => {
      if (!s.hydrated) return;
      off();
      resolve(s);
    });
  });
}

/**
 * Shows notifications that arrive while the app is open, refreshes the bell count, and opens the right screen
 * (in the right institution) when a notification is tapped, including the tap that launched the app.
 */
export function PushNotificationsBridge() {
  const qc = useQueryClient();
  // Where the app is when a push is tapped, read then rather than when the listeners were added.
  const pathname = usePathname();
  const shown = useRef(pathname);
  useEffect(() => {
    shown.current = pathname;
  }, [pathname]);
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
      // Already there: a chat push mostly comes while a thread is open in an app in the background, and pushing the same
      // thread again would stack a copy of it, with Back showing the same conversation.
      if (isOpenThread(data)) return;
      // withAnchor puts each layout's anchor under the screen, so one opened from a push (also on a cold start, with
      // nothing mounted yet) has a real way back: a thread lands above the tabs, a job above the job list, a console
      // screen above the console's home.
      const fallback = `/t/${slug}/profile/notifications` as const;
      if (!isAdminNotification(data.type ?? "")) {
        router.push(notificationHref(slug, data.type ?? "", data, { isAdmin: false }) ?? fallback, { withAnchor: true });
        return;
      }
      // The console may already be open on what the push is about.
      void qc.invalidateQueries({ queryKey: ["admin", slug] });
      // Whether this is an admin: the loaded membership, or on a cold start, before it has loaded, the stored session.
      void storedSession().then((session) => {
        const href = notificationHref(slug, data.type ?? "", data, { isAdmin: isPushAdminOf(session, qc.getQueryData<MembershipDto>(qk.membership(slug)), slug) });
        if (!href) router.push(fallback, { withAnchor: true });
        // Navigate, so a console home already in front isn't stacked again, and on a cold start the institution the
        // start screen has just redirected to is reused rather than a second one added.
        else if (opensInPlace(shown.current, slug)) router.navigate(href, { withAnchor: true });
        else router.push(href, { withAnchor: true });
      });
    };

    (async () => {
      const Notifications = await import("expo-notifications");
      if (!active) return;
      Notifications.setNotificationHandler({
        handleNotification: async (n) => (isForOpenThread((n.request.content.data ?? {}) as PushData) ? HIDE : SHOW),
      });
      subs.push(
        Notifications.addNotificationReceivedListener((n) => {
          const data = (n.request.content.data ?? {}) as PushData;
          if (!data.tenantSlug) return;
          void qc.invalidateQueries({ queryKey: qk.notifications(data.tenantSlug) });
          // The live connection normally gets there first; a push is the hint when it hasn't.
          if (data.conversationId) void qc.invalidateQueries({ queryKey: chatKeys.badge(data.tenantSlug) });
          if (data.type === "CHAT_GROUP_INVITE") void qc.invalidateQueries({ queryKey: chatKeys.groupInvites(data.tenantSlug) });
          if (data.type && MENTORSHIP_TYPES.has(data.type)) void qc.invalidateQueries({ queryKey: mentorshipKeys.all(data.tenantSlug) });
          if (data.type && REFERRAL_TYPES.has(data.type)) void refreshReferrals(qc, data.tenantSlug);
          if (data.type && isAdminNotification(data.type)) void qc.invalidateQueries({ queryKey: ["admin", data.tenantSlug] });
        }),
      );
      subs.push(
        Notifications.addNotificationResponseReceivedListener((r) => {
          open(r.notification.request.identifier, (r.notification.request.content.data ?? {}) as PushData);
        }),
      );
      const launch = Notifications.getLastNotificationResponse();
      if (active && launch) {
        open(launch.notification.request.identifier, (launch.notification.request.content.data ?? {}) as PushData);
        Notifications.clearLastNotificationResponse();
      }
    })().catch(() => undefined);

    return () => {
      active = false;
      subs.forEach((s) => s.remove());
    };
  }, [qc]);
  return null;
}
