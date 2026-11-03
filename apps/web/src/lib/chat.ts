import type { ChatConversationDto, ChatInbox } from "@illuminize/shared";
import { activeChat, chatKeys, createChatSync } from "@illuminize/shared/chat";
import type { QueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { realtime } from "@/lib/realtime";
import { useAuthStore } from "@/stores/authStore";
import { useChatStore } from "@/stores/chatStore";

/** The app's one chat subscriber, attached by RealtimeBridge. Screens read the cache and send through this. */
export const chatSync = createChatSync({
  realtime,
  api: api.chat,
  queryClient,
  getActive: () => activeChat(useChatStore.getState().focus),
  // The badge is on screen everywhere, and 30 seconds behind a message shows.
  badgeEveryMs: 5_000,
});

// Message text and drafts belong to whoever is signed in. Every way out of a session (sign out, a 401, an account deleted) goes through here.
useAuthStore.subscribe((state, previous) => {
  if (state.user?.id === previous.user?.id) return;
  useChatStore.getState().forgetConversations();
  queryClient.removeQueries({ queryKey: ["chat"] });
});

/** The inbox tab, kept in the URL on every Messages route, so the list beside a thread, a back link and a reload all agree. */
export const inboxFromParams = (params: URLSearchParams): ChatInbox => (params.get("tab") === "requests" ? "REQUESTS" : "MAIN");
export const inboxQuery = (inbox: ChatInbox) => (inbox === "REQUESTS" ? "?tab=requests" : "");

// Shared with the mobile app, so both say the same thing about a thread.
export { formatChatTime, isMuted, peerName } from "@illuminize/shared/chat";

/** Puts a thread's newer state wherever it's cached, so the list and the open thread agree without a refetch. */
export function patchConversation(qc: QueryClient, slug: string, id: string, patch: (c: ChatConversationDto) => ChatConversationDto) {
  qc.setQueryData<ChatConversationDto>(chatKeys.conversation(slug, id), (old) => (old ? patch(old) : old));
  qc.setQueriesData<{ pages: Array<{ data: ChatConversationDto[]; nextCursor: string | null }>; pageParams: unknown[] }>({ queryKey: chatKeys.lists(slug) }, (old) =>
    old ? { ...old, pages: old.pages.map((page) => ({ ...page, data: page.data.map((c) => (c.id === id ? patch(c) : c)) })) } : old,
  );
}

/** After an action that can change a thread anywhere: its state, the lists, the badge and the profile lookups. Outboxes are left alone. */
export function refreshChat(qc: QueryClient, slug: string) {
  return qc.invalidateQueries({ queryKey: chatKeys.all(slug), predicate: (q) => q.queryKey[2] !== "outbox" });
}
