import { errorMessage, isApiClientError, isTransientError } from "@illuminize/shared/client";
import { useRouter } from "expo-router";
import { ChatHeader, ChatNotice, ChatScreen, useLeaveChatScreen } from "@/components/chat/ChatFrame";
import { IconGroups, IconLock } from "@/components/icons";
import { Button } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { groupsHref } from "@/lib/groups";
import { colors } from "@/theme";

/** Groups are switched on here and this member isn't a current pupil. Nothing about groups is shown or fetched otherwise. */
export function useGroupsEnabled(): boolean {
  const { tenant, membership } = useMembership();
  return tenant.settings.features.groups && membership.chatEligible;
}

/**
 * Groups are off, or this member is a current pupil. The group screens above the tabs check this themselves, because the
 * Groups tab's gate doesn't cover them, and make no calls when it's shown.
 */
export function GroupsOff({ title = "Groups" }: { title?: string }) {
  const { tenant } = useMembership();
  const leave = useLeaveChatScreen();
  return (
    <ChatScreen>
      <ChatHeader title={title} />
      <ChatNotice icon={<IconLock size={32} color={colors.faint} />} title="Groups aren't available" text={`Groups aren't open to your account at ${tenant.shortName ?? tenant.name}.`}>
        <Button title="Go back" onPress={leave} />
      </ChatNotice>
    </ChatScreen>
  );
}

/**
 * A group that can't be shown says why in plain words and offers a way on, and never blanks the app. A group that doesn't
 * exist and one this member may not know about read the same, as the API answers them.
 */
export function GroupUnavailable({ header, error, title, text, onRetry }: { header: string; error?: unknown; title?: string; text?: string; onRetry?: () => void }) {
  const { tenant } = useMembership();
  const router = useRouter();
  const answered = isApiClientError(error) && !isTransientError(error);
  const off = isApiClientError(error) && error.code === "FEATURE_DISABLED";
  const heading = title ?? (off ? "Groups aren't available" : answered || !error ? "This group isn't available" : "This group couldn't be opened");
  const body = text ?? (off ? errorMessage(error) : answered || !error ? "It may have been archived or removed, or the link may be wrong." : "Check your connection, then try again.");
  return (
    <ChatScreen>
      <ChatHeader title={header} />
      <ChatNotice icon={<IconGroups size={32} color={colors.faint} />} title={heading} text={body}>
        {error !== undefined && !answered && onRetry && <Button title="Retry loading" variant="outline" onPress={onRetry} />}
        {/* Back to the lists, in place of this screen: whatever is under it may be the same group. */}
        <Button title="Back to groups" accessibilityRole="link" onPress={() => router.dismissTo(groupsHref(tenant.slug))} />
      </ChatNotice>
    </ChatScreen>
  );
}
