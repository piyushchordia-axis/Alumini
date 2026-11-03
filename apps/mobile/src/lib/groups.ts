import type { ChatGroupDto, TenantPublicDto } from "@illuminize/shared";
import { chatKeys } from "@illuminize/shared/chat";
import type { QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { refreshChat } from "@/lib/chat";
import { useChatStore } from "@/stores/chatStore";

export type GroupsTab = "discover" | "mine" | "invitations";

/** The Groups tab from the URL, as on the web app, so a push about an invitation lands on Invitations. */
export const groupsTabFromParam = (tab: string | string[] | undefined): GroupsTab => (tab === "mine" || tab === "invitations" ? tab : "discover");

export const groupsHref = (slug: string, tab: GroupsTab = "discover") => `/t/${slug}/groups${tab === "discover" ? "" : `?tab=${tab}`}` as const;
export const groupHref = (slug: string, id: string) => `/t/${slug}/groups/${id}` as const;
export const groupChatHref = (slug: string, id: string) => `/t/${slug}/messages/${id}` as const;

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

/**
 * Says something on the screen a member lands on after another group screen has done its work and gone, as the web app's
 * toasts do: `on` is "groups" for the Groups screen, "mentors" for the Mentors screen, or a group's id for its details.
 */
export const leaveGroupNotice = (on: string, text: string) => useChatStore.getState().setGroupNotice({ on, text });

/** Shows, through `show`, what another screen left for this one, once. */
export function useGroupNotice(on: string, show: (text: string) => void) {
  const notice = useChatStore((s) => s.groupNotice);
  useEffect(() => {
    if (!notice || notice.on !== on) return;
    show(notice.text);
    useChatStore.getState().setGroupNotice(null);
  }, [notice, on, show]);
}
