import { enabledGroupVisibilities } from "@illuminize/shared";
import { chatKeys } from "@illuminize/shared/chat";
import { fatalQueryError } from "@illuminize/shared/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { GroupForm } from "@/components/groups/GroupForm";
import { GroupUnavailable } from "@/components/groups/GroupUnavailable";
import { Card, Loading, PageHeader } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { groupChatPath, groupPath, groupsAreReviewed, groupsPath, refreshGroup } from "@/lib/groups";
import { toast } from "@/stores/uiStore";

/** Create group, and Edit group for its owner, which changes the name and description only. */
export function GroupFormPage() {
  const { tenant, isTenantAdmin } = useMembership();
  const slug = tenant.slug;
  const { groupId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const reviewed = groupsAreReviewed(tenant, isTenantAdmin);
  const institution = tenant.shortName ?? tenant.name;
  const existing = useQuery({ queryKey: chatKeys.group(slug, groupId ?? ""), queryFn: () => api.chat.groups.get(slug, groupId!), enabled: !!groupId });

  if (!groupId) {
    return (
      <div className="mx-auto max-w-2xl">
        <Link to={groupsPath(slug)} className="text-sm text-slate-500 hover:text-slate-800">
          ← Groups
        </Link>
        <PageHeader title="Create group" subtitle="A shared conversation with other members" />
        <Card className="p-5">
          <GroupForm
            available={enabledGroupVisibilities(tenant.settings.features)}
            unavailableNote={`Invite-only groups need private messages, which ${institution} has switched off.`}
            notice={reviewed ? `${institution} reviews new groups. Only you can see this one until an admin approves it, and nobody can send messages in it until then.` : undefined}
            submitLabel="Create group"
            onSubmit={async (v) => {
              const group = await api.chat.groups.create(slug, v);
              void refreshGroup(qc, slug, group);
              // In place of this form, as on the app, so going back from the group doesn't land on a form that would make it again.
              if (group.review?.shownToMembers === false) {
                toast.success("Submitted. It starts once an admin approves it.");
                navigate(groupPath(slug, group.id), { replace: true });
              } else {
                // The new group's own chat says it's made, as on the app.
                navigate(groupChatPath(slug, group.id), { replace: true });
              }
            }}
          />
        </Card>
      </div>
    );
  }

  // Only with nothing to show: a failed background refetch mustn't replace the form and lose what was typed.
  const error = fatalQueryError(existing);
  if (error) return <GroupUnavailable error={error} slug={slug} onRetry={() => void existing.refetch()} />;
  if (!existing.data) return <Loading />;
  const group = existing.data;
  if (!group.canEdit) return <GroupUnavailable slug={slug} title="You can't edit this group" text="Only its owner can, while it isn't archived or removed." />;
  const review = group.review;
  return (
    <div className="mx-auto max-w-2xl">
      <Link to={groupPath(slug, group.id)} className="text-sm text-slate-500 hover:text-slate-800">
        ← Group details
      </Link>
      <PageHeader title="Edit group" />
      <Card className="p-5">
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
            toast.success(saved.review?.moderationStatus === "PENDING" ? "Saved. An admin will review your changes." : "Group saved");
            // Back to the details this was opened from, as the app does, or with none behind it, the details in its place:
            // either way, going back from the details doesn't return to this form.
            if ((location.state as { fromGroup?: string } | null)?.fromGroup === group.id) navigate(-1);
            else navigate(groupPath(slug, group.id), { replace: true });
          }}
        />
      </Card>
    </div>
  );
}
