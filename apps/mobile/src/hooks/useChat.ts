import { chatAvailable } from "@illuminize/shared";
import { chatKeys } from "@illuminize/shared/chat";
import { useQuery } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { AppState, Keyboard, Platform } from "react-native";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { usePollInterval } from "@/lib/realtime";
import { useChatStore } from "@/stores/chatStore";

/** Says which institution's chat this member is in, for as long as the layout calling this is on screen. */
export function useChatScope(slug: string | undefined, enabled: boolean) {
  const setScope = useChatStore((s) => s.setScope);
  useEffect(() => {
    setScope(enabled && slug ? slug : null);
    return () => setScope(null);
  }, [slug, enabled, setScope]);
}

/** The Messages badge. Live events keep it current, so polling is only the fallback. `enabled` false makes no calls: a pupil's poll would be a 403 every minute. */
export function useChatBadge(slug: string, enabled: boolean) {
  const pollInterval = usePollInterval();
  return useQuery({ queryKey: chatKeys.badge(slug), queryFn: () => api.chat.badge(slug), enabled, refetchInterval: pollInterval });
}

/** Messages or groups are switched on for this institution and this member isn't a current pupil. Nothing about chat is shown or fetched otherwise. */
export function useChatEnabled(): boolean {
  const { tenant, membership } = useMembership();
  return chatAvailable(tenant.settings.features, membership.chatEligible);
}

/**
 * Says which thread is on screen while its screen is focused, so live events for it fill gaps at once, catching up after a
 * reconnect reads it again, and a push for it shows no banner.
 */
export function useOpenConversation(slug: string, conversationId: string) {
  const open = useChatStore((s) => s.openConversation);
  const close = useChatStore((s) => s.closeConversation);
  useFocusEffect(
    // It names its institution, because this runs before the (app) layout's useChatScope when both mount together, as on a
    // cold-start push tap. Closing clears only its own: the next thread may already have said it's open.
    useCallback(() => {
      open(slug, conversationId);
      return () => close(slug, conversationId);
    }, [slug, conversationId, open, close]),
  );
}

function subscribeAppState(onChange: () => void) {
  const sub = AppState.addEventListener("change", onChange);
  return () => sub.remove();
}

/** False while the app is in the background, or on its way there, when nothing in it is being read. */
export function useAppActive(): boolean {
  return useSyncExternalStore(subscribeAppState, () => AppState.currentState === "active");
}

/** Whether the on-screen keyboard is up. iOS says so as it starts to move, Android only once it has. */
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(() => Keyboard.isVisible());
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", () => setVisible(true));
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}

/** The time, a minute at a time, for labels such as "Today". A render can't read the clock itself. */
export function useNow(everyMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}
