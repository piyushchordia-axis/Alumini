import type { TenantFeatures } from "../constants";
import type { EmptyAction } from "../lib/emptyStates";
import type { ChatConversationDto } from "../types/dto";
import { conversationTitle } from "./labels";

type ChatSwitches = Pick<TenantFeatures, "messaging" | "directory" | "groups">;

/** What an empty Chats tab suggests, from whichever kinds of chat the institution has on. */
export function emptyChatsHint(features: ChatSwitches): string {
  if (!features.messaging) return "When you join a group, its conversation shows here.";
  const message = features.directory ? "Open a member's profile in the Directory and choose Message this member" : "When you message a member, or accept a request, the conversation shows here";
  if (!features.groups) return `${message}.`;
  return features.directory ? `${message}, or join a group.` : "When you message a member, accept a request or join a group, the conversation shows here.";
}

/** Where an empty Chats tab can send the member: the Directory, where a conversation starts from a profile, or Groups. */
export type EmptyChatsTarget = "directory" | "groups";

export interface EmptyChatsAction {
  target: EmptyChatsTarget;
  label: string;
  /** The first is the main way on, and the other outline. */
  variant: EmptyAction["variant"];
}

const EMPTY_CHATS_LABELS: Readonly<Record<EmptyChatsTarget, string>> = { directory: "Find people", groups: "Find a group" };

/**
 * The links an empty Chats tab offers, each only while the member could use what it opens: Find people while the Directory
 * is on and they may message someone there, and Find a group while groups are on. A member who may not chat (a current
 * pupil) gets neither.
 */
export function emptyChatsActions(features: ChatSwitches, chatEligible: boolean): EmptyChatsAction[] {
  if (!chatEligible) return [];
  const targets: EmptyChatsTarget[] = [];
  if (features.messaging && features.directory) targets.push("directory");
  if (features.groups) targets.push("groups");
  return targets.map((target, i) => ({ target, label: EMPTY_CHATS_LABELS[target], variant: i === 0 ? "primary" : "outline" }));
}

/**
 * The line under "No messages yet" in a thread with nothing in it. It comes from the thread's name alone, never from
 * where the thread stands, so a member someone has blocked reads the same words as anyone else.
 */
export function emptyThreadText(c: Pick<ChatConversationDto, "group" | "peer">): string {
  const name = conversationTitle(c);
  return c.group ? `Messages in ${name} show here.` : `Messages between you and ${name} show here.`;
}
