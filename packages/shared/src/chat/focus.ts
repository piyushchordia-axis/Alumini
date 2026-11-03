/**
 * Where a member is in chat: the institution whose member app is on screen, and the thread open in it. The two are set by
 * different components, a layout and the thread inside it, whose effects run child first when they mount together (a reload,
 * a pasted link, a push that cold-starts the app). So the thread records its own institution with its id, and nothing the
 * layout does can wipe it out.
 */
export interface ChatFocus {
  /** The institution whose chat this member can use, while they're in its member app. */
  slug: string | null;
  /** The thread on screen, with the institution it belongs to. */
  open: { slug: string; conversationId: string } | null;
}

export const NO_CHAT_FOCUS: ChatFocus = { slug: null, open: null };

/** Entering or leaving an institution's member app. The open thread stays as the thread itself set it. */
export function focusScope(focus: ChatFocus, slug: string | null): ChatFocus {
  return focus.slug === slug ? focus : { ...focus, slug };
}

export function focusThread(focus: ChatFocus, slug: string, conversationId: string): ChatFocus {
  return focus.open?.slug === slug && focus.open.conversationId === conversationId ? focus : { ...focus, open: { slug, conversationId } };
}

/** A thread leaving the screen clears only itself: when one replaces another, the next may already have said it's open. */
export function unfocusThread(focus: ChatFocus, slug: string, conversationId: string): ChatFocus {
  return focus.open?.slug === slug && focus.open.conversationId === conversationId ? { ...focus, open: null } : focus;
}

/** What the chat sync and push handling act on: the institution on screen, and its open thread if there is one. */
export function activeChat(focus: ChatFocus): { slug: string; conversationId: string | null } | null {
  if (!focus.slug) return null;
  return { slug: focus.slug, conversationId: focus.open?.slug === focus.slug ? focus.open.conversationId : null };
}
