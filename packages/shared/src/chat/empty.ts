import type { TenantFeatures } from "../constants";

/** What an empty Chats tab suggests, from whichever kinds of chat the institution has on. */
export function emptyChatsHint(features: Pick<TenantFeatures, "messaging" | "directory" | "groups">): string {
  if (!features.messaging) return "When you join a group, its conversation shows here.";
  const message = features.directory ? "Open a member's profile in the Directory and choose Message this member" : "When you message a member, or accept a request, the conversation shows here";
  if (!features.groups) return `${message}.`;
  return features.directory ? `${message}, or join a group.` : "When you message a member, accept a request or join a group, the conversation shows here.";
}
