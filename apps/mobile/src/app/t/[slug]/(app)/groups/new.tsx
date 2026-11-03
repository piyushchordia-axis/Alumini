import { enabledGroupVisibilities } from "@illuminize/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChatHeader, ChatScreen } from "@/components/chat/ChatFrame";
import { GroupsOff, useGroupsEnabled } from "@/components/groups/GroupFrame";
import { GroupForm } from "@/components/groups/GroupForm";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { groupChatHref, groupHref, groupsAreReviewed, leaveGroupNotice, refreshGroup } from "@/lib/groups";
import { spacing } from "@/theme";

export default function NewGroupScreen() {
  const enabled = useGroupsEnabled();
  if (!enabled) return <GroupsOff title="Create group" />;
  return <NewGroup />;
}

/** Create group, above the tabs. Says before anything is sent what each choice means, that it's for good, and whether an admin reviews it. */
function NewGroup() {
  const { tenant, isTenantAdmin } = useMembership();
  const slug = tenant.slug;
  const router = useRouter();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const institution = tenant.shortName ?? tenant.name;
  const reviewed = groupsAreReviewed(tenant, isTenantAdmin);
  return (
    <ChatScreen>
      <ChatHeader title="Create group" />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl + insets.bottom }}>
        <GroupForm
          available={enabledGroupVisibilities(tenant.settings.features)}
          unavailableNote={`Invite-only groups need private messages, which ${institution} has switched off.`}
          notice={reviewed ? `${institution} reviews new groups. Only you can see this one until an admin approves it, and nobody can send messages in it until then.` : undefined}
          submitLabel="Create group"
          onSubmit={async (v) => {
            const group = await api.chat.groups.create(slug, v);
            void refreshGroup(qc, slug, group);
            // In place of this form, so going back from the group doesn't land on a form that would make it again. One
            // waiting for an admin opens on its details, which say so, as the web app does.
            const waiting = group.review?.shownToMembers === false;
            if (waiting) leaveGroupNotice(group.id, "Submitted. It starts once an admin approves it.");
            router.replace(waiting ? groupHref(slug, group.id) : groupChatHref(slug, group.id));
          }}
        />
      </ScrollView>
    </ChatScreen>
  );
}
