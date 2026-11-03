import type { ChatInbox } from "../constants";

/** Query keys for chat, with the slug second like every other tenant key, so a tenant-wide invalidation reaches them. */
export const chatKeys = {
  all: (slug: string) => ["chat", slug] as const,
  lists: (slug: string) => ["chat", slug, "conversations"] as const,
  list: (slug: string, inbox: ChatInbox) => ["chat", slug, "conversations", inbox] as const,
  conversation: (slug: string, id: string) => ["chat", slug, "conversation", id] as const,
  /** Which thread, if any, this member already has with another. */
  direct: (slug: string, membershipId: string) => ["chat", slug, "direct", membershipId] as const,
  threads: (slug: string) => ["chat", slug, "messages"] as const,
  messages: (slug: string, id: string) => ["chat", slug, "messages", id] as const,
  outbox: (slug: string, id: string) => ["chat", slug, "outbox", id] as const,
  badge: (slug: string) => ["chat", slug, "badge"] as const,
  blocks: (slug: string) => ["chat", slug, "blocks"] as const,
};
