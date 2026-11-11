import { focusScope, focusThread, NO_CHAT_FOCUS, unfocusThread, type ChatFocus, type TrayItem } from "@illuminize/shared/chat";
import { create } from "zustand";

interface ChatState {
  /** The institution whose chat is on screen, and the thread open in it (see activeChat). */
  focus: ChatFocus;
  /** What's been typed and not sent, by `draftKey`. Memory only, so this store must never be persisted. */
  drafts: Record<string, string>;
  /**
   * Photos and PDFs added to the message being written, by `draftKey`, uploading or uploaded. Memory only, like drafts.
   * Their uploads and previews are kept in lib/chatAttachments, which changes these through setTray.
   */
  trays: Record<string, TrayItem[]>;
  setScope: (slug: string | null) => void;
  openConversation: (slug: string, conversationId: string) => void;
  closeConversation: (slug: string, conversationId: string) => void;
  setDraft: (key: string, text: string) => void;
  setTray: (key: string, update: (tray: TrayItem[]) => TrayItem[]) => void;
  forgetConversations: () => void;
}

/** `target` is a conversation id, or something else that can't be mistaken for one when a thread doesn't exist yet. */
export const draftKey = (slug: string, target: string) => `${slug}:${target}`;

const without = <T>(record: Record<string, T>, key: string) => Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));

export const useChatStore = create<ChatState>((set) => ({
  focus: NO_CHAT_FOCUS,
  drafts: {},
  trays: {},
  setScope: (slug) => set((s) => ({ focus: focusScope(s.focus, slug) })),
  openConversation: (slug, conversationId) => set((s) => ({ focus: focusThread(s.focus, slug, conversationId) })),
  closeConversation: (slug, conversationId) => set((s) => ({ focus: unfocusThread(s.focus, slug, conversationId) })),
  setDraft: (key, text) => set((s) => ({ drafts: text ? { ...s.drafts, [key]: text } : without(s.drafts, key) })),
  setTray: (key, update) =>
    set((s) => {
      const tray = update(s.trays[key] ?? []);
      return { trays: tray.length ? { ...s.trays, [key]: tray } : without(s.trays, key) };
    }),
  forgetConversations: () => set((s) => ({ focus: { ...s.focus, open: null }, drafts: {}, trays: {} })),
}));
