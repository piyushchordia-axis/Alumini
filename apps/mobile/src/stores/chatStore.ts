import type { ChatInbox } from "@illuminize/shared";
import { focusScope, focusThread, NO_CHAT_FOCUS, unfocusThread, type ChatFocus } from "@illuminize/shared/chat";
import { create } from "zustand";

interface ChatState {
  /** The institution whose chat is on screen, and the thread open in it (see activeChat). */
  focus: ChatFocus;
  /** What's been typed and not sent, by `draftKey`. Memory only, so this store must never be persisted. */
  drafts: Record<string, string>;
  /** The inbox tab showing, which a thread changes when it answers a request: accepting moves it to Chats, declining leaves Requests. */
  inbox: ChatInbox;
  /**
   * What a group screen says once another has done something and gone, such as "You left the group" on Groups after leaving
   * from a group's details. For the screen named by `on` alone: Groups, or one group's details by its id.
   */
  groupNotice: GroupNotice | null;
  setScope: (slug: string | null) => void;
  openConversation: (slug: string, conversationId: string) => void;
  closeConversation: (slug: string, conversationId: string) => void;
  setDraft: (key: string, text: string) => void;
  setInbox: (inbox: ChatInbox) => void;
  setGroupNotice: (notice: GroupNotice | null) => void;
  forgetConversations: () => void;
}

export interface GroupNotice {
  /** "groups" for the Groups screen, "mentors" for the Mentors screen, or a group's id for its details. */
  on: string;
  text: string;
}

/** `target` is a conversation id, or something else that can't be mistaken for one when a thread doesn't exist yet. */
export const draftKey = (slug: string, target: string) => `${slug}:${target}`;

export const useChatStore = create<ChatState>((set) => ({
  focus: NO_CHAT_FOCUS,
  drafts: {},
  inbox: "MAIN",
  groupNotice: null,
  setScope: (slug) => set((s) => (s.focus.slug === slug ? s : { focus: focusScope(s.focus, slug), inbox: "MAIN" })),
  openConversation: (slug, conversationId) => set((s) => ({ focus: focusThread(s.focus, slug, conversationId) })),
  closeConversation: (slug, conversationId) => set((s) => ({ focus: unfocusThread(s.focus, slug, conversationId) })),
  setDraft: (key, text) => set((s) => ({ drafts: text ? { ...s.drafts, [key]: text } : Object.fromEntries(Object.entries(s.drafts).filter(([k]) => k !== key)) })),
  setInbox: (inbox) => set({ inbox }),
  setGroupNotice: (groupNotice) => set({ groupNotice }),
  forgetConversations: () => set((s) => ({ focus: { ...s.focus, open: null }, drafts: {}, inbox: "MAIN", groupNotice: null })),
}));
