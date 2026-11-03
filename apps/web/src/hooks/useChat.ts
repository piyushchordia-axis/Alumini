import { chatKeys } from "@illuminize/shared/chat";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore } from "react";
import { api } from "@/lib/api";
import { usePollInterval } from "@/lib/realtime";
import { useChatStore } from "@/stores/chatStore";

/** Says which institution's chat this member is in, for as long as the layout calling this is on screen. */
export function useChatScope(slug: string, enabled: boolean) {
  const setScope = useChatStore((s) => s.setScope);
  useEffect(() => {
    setScope(enabled ? slug : null);
    return () => setScope(null);
  }, [slug, enabled, setScope]);
}

/** The Messages badge. Live events keep it current, so polling is only the fallback. `enabled` false makes no calls: a pupil's poll would be a 403 every minute. */
export function useChatBadge(slug: string, enabled: boolean) {
  const pollInterval = usePollInterval();
  return useQuery({ queryKey: chatKeys.badge(slug), queryFn: () => api.chat.badge(slug), enabled, refetchInterval: pollInterval });
}

/**
 * Says which thread is on screen, so live events for it fill gaps at once and catching up after a reconnect reads it again.
 * It names its institution, because this runs before the layout's useChatScope when both mount together.
 */
export function useOpenConversation(slug: string, conversationId: string) {
  const open = useChatStore((s) => s.openConversation);
  const close = useChatStore((s) => s.closeConversation);
  useEffect(() => {
    open(slug, conversationId);
    return () => close(slug, conversationId);
  }, [slug, conversationId, open, close]);
}

function subscribeVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

/** False while the tab is in the background or the window is minimised, when nothing on it is being read. */
export function useDocumentVisible(): boolean {
  return useSyncExternalStore(subscribeVisibility, () => document.visibilityState === "visible", () => true);
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
