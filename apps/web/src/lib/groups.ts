import type { ChatGroupDto, TenantPublicDto } from "@illuminize/shared";
import { chatKeys } from "@illuminize/shared/chat";
import type { QueryClient } from "@tanstack/react-query";
import { refreshChat } from "@/lib/chat";

export type GroupsTab = "discover" | "mine" | "invitations";

/** The Groups tab, kept in the URL like the Messages inbox's, so a back link, a reload and a push for an invitation all land on it. */
export const groupsTabFromParams = (params: URLSearchParams): GroupsTab => {
  const tab = params.get("tab");
  return tab === "mine" || tab === "invitations" ? tab : "discover";
};

export const groupsPath = (slug: string, tab: GroupsTab = "discover") => `/t/${slug}/app/groups${tab === "discover" ? "" : `?tab=${tab}`}`;
export const groupPath = (slug: string, id: string) => `/t/${slug}/app/groups/${id}`;
export const groupChatPath = (slug: string, id: string) => `/t/${slug}/app/messages/${id}`;

/** Whether a group this member starts waits for an admin first. An admin's own never does. */
export const groupsAreReviewed = (tenant: TenantPublicDto, isTenantAdmin: boolean) => tenant.settings.contentModerationMode === "ADMIN_APPROVAL" && !isTenantAdmin;

/** After joining, leaving or changing a group: its details, the Groups lists, the inbox and both badges. */
export function refreshGroup(qc: QueryClient, slug: string, group?: ChatGroupDto) {
  if (group) qc.setQueryData(chatKeys.group(slug, group.id), group);
  return refreshChat(qc, slug);
}

/**
 * Once a member is out of a group, nothing of its thread stays in memory: an invite-only group is closed to them from now on,
 * and an open one is read afresh if they come back.
 */
export function forgetGroupThread(qc: QueryClient, slug: string, id: string) {
  for (const key of [chatKeys.messages(slug, id), chatKeys.outbox(slug, id), chatKeys.conversation(slug, id)]) qc.removeQueries({ queryKey: key });
}
