import { chatKeys } from "@illuminize/shared/chat";
import { fatalQueryError } from "@illuminize/shared/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChatHeader, ChatScreen } from "@/components/chat/ChatFrame";
import { GroupUnavailable, GroupsOff, useGroupsEnabled } from "@/components/groups/GroupFrame";
import { GroupForm } from "@/components/groups/GroupForm";
import { Spinner } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { groupHref, groupsAreReviewed, leaveGroupNotice, refreshGroup } from "@/lib/groups";
import { spacing } from "@/theme";

export default function EditGroupScreen() {
  const enabled = useGroupsEnabled();
  const { groupId = "" } = useLocalSearchParams<{ groupId: string }>();
  if (!enabled) return <GroupsOff title="Edit group" />;
  return <EditGroup key={groupId} id={groupId} />;
}

/** Edit group, for its owner: the name and description only. Who can join never changes. */
function EditGroup({ id }: { id: string }) {
  const { tenant, isTenantAdmin } = useMembership();
  const slug = tenant.slug;
  const router = useRouter();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const reviewed = groupsAreReviewed(tenant, isTenantAdmin);
  const existing = useQuery({ queryKey: chatKeys.group(slug, id), queryFn: () => api.chat.groups.get(slug, id) });

  // Only with nothing to show: a failed background refetch mustn't replace the form and lose what was typed.
  const error = fatalQueryError(existing);
  if (error) return <GroupUnavailable header="Edit group" error={error} onRetry={() => void existing.refetch()} />;
  if (!existing.data) {
    return (
      <ChatScreen>
        <ChatHeader title="Edit group" />
        <Spinner label="Loading group…" />
      </ChatScreen>
    );
  }
  const group = existing.data;
  if (!group.canEdit) return <GroupUnavailable header="Edit group" title="You can't edit this group" text="Only its owner can, while it isn't archived or removed." />;
  const review = group.review;
  return (
    <ChatScreen>
      <ChatHeader title="Edit group" />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl + insets.bottom }}>
        <GroupForm
          // What the owner last submitted, which is what they're editing, even while members still see the approved version.
          initial={review ? { name: review.name, description: review.description } : { name: group.name, description: group.description }}
          visibility={group.visibility}
          available={[group.visibility]}
          notice={
            reviewed
              ? review?.shownToMembers
                ? "An admin reviews changes before members see them. The group keeps going meanwhile, but nobody can invite anyone until an admin has looked."
                : "An admin reviews the group before anyone else can see it."
              : undefined
          }
          submitLabel="Save changes"
          onSubmit={async (v) => {
            const saved = await api.chat.groups.update(slug, group.id, { name: v.name, description: v.description });
            void refreshGroup(qc, slug, saved);
            leaveGroupNotice(group.id, saved.review?.moderationStatus === "PENDING" ? "Saved. An admin will review your changes." : "Group saved");
            // Back to the details this was opened from, or, opened from a link with none underneath, the details in its place.
            router.dismissTo(groupHref(slug, group.id));
          }}
        />
      </ScrollView>
    </ChatScreen>
  );
}
