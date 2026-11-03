import type { ChatGroupScope, ChatInbox } from "../constants";

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
  /** Every list on the Groups screens, invitations included. */
  groupLists: (slug: string) => ["chat", slug, "groups"] as const,
  groupList: (slug: string, scope: ChatGroupScope, q = "") => ["chat", slug, "groups", scope, q] as const,
  groupInvites: (slug: string) => ["chat", slug, "groups", "invites"] as const,
  group: (slug: string, id: string) => ["chat", slug, "group", id] as const,
  groupMembers: (slug: string, id: string) => ["chat", slug, "group", id, "members"] as const,
  groupCandidates: (slug: string, id: string, q = "") => ["chat", slug, "group", id, "candidates", q] as const,
};
