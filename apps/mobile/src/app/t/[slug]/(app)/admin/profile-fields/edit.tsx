import type { ProfileFieldDraft } from "@illuminize/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { AdminScreen } from "@/components/admin/AdminScreen";
import { FieldEditorForm } from "@/components/admin/FieldEditorForm";
import { IconFields } from "@/components/icons";
import { Button, EmptyState, ErrorText, Spinner } from "@/components/ui";
import { refreshProfileFields, useAdminProfileFields } from "@/hooks/useAdminProfileFields";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { leaveGroupNotice } from "@/lib/groups";
import { colors } from "@/theme";

/**
 * The profile-field editor, a modal above the console's list: `?id` edits that field, none adds one. There's no API to
 * read one field, so it's found in the active list. Closing it discards what was typed, as the web dialog's Cancel does.
 */
export default function ProfileFieldEditScreen() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const router = useRouter();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const list = useAdminProfileFields(slug, false);
  const field = id ? list.data?.find((f) => f.id === id) : null;
  const leave = () => (router.canGoBack() ? router.back() : router.replace(`/t/${slug}/admin/profile-fields`));

  if (id && !list.data) {
    return (
      <AdminScreen title="Edit profile field">
        {/* Only until the first answer: a refetch keeps the form, and what's typed in it. */}
        {list.isLoading && !list.isFetched ? (
          <Spinner label="Loading the field" />
        ) : (
          <>
            <ErrorText error={list.error ?? "Couldn't load the field"} />
            <Button title="Try again" variant="outline" onPress={() => void list.refetch()} />
          </>
        )}
      </AdminScreen>
    );
  }
  if (id && !field) {
    return (
      <AdminScreen title="Edit profile field">
        <EmptyState icon={<IconFields size={32} color={colors.faint} />} title="This field was archived or removed" description="Restore it from Show archived fields to edit it." />
        <Button title="Back to profile fields" variant="outline" onPress={leave} />
      </AdminScreen>
    );
  }

  const save = async (body: ProfileFieldDraft) => {
    if (field) {
      const { key: _key, ...rest } = body;
      await api.admin.profileFields.update(slug, field.id, rest);
    } else {
      await api.admin.profileFields.create(slug, body);
    }
    void refreshProfileFields(qc, slug);
    leaveGroupNotice("admin:profile-fields", field ? "Field saved" : "Field added");
    leave();
  };

  return (
    <AdminScreen title={field ? `Edit “${field.label}”` : "Add a profile field"}>
      {/* Keyed on the field, so a refetch of the list never resets what's typed. */}
      <FieldEditorForm key={field?.id ?? "new"} field={field ?? null} onSubmit={save} />
    </AdminScreen>
  );
}
