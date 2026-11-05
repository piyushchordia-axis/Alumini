import { MAX_PROFILE_FIELDS, archiveFieldConfirm, inFieldOrder, moveId, profileFieldsSubtitle, type ProfileFieldDto } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { AdminListScreen } from "@/components/admin/AdminListScreen";
import { FieldRow } from "@/components/admin/FieldRow";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { IconFields, IconPlus } from "@/components/icons";
import { StatusLine } from "@/components/Sheet";
import { Button, Choice, EmptyState, ListEmpty, Muted } from "@/components/ui";
import { adminProfileFieldsKey, refreshProfileFields, useAdminProfileFields } from "@/hooks/useAdminProfileFields";
import { useMembership } from "@/hooks/useMembership";
import { useStatus } from "@/hooks/useStatus";
import { api } from "@/lib/api";
import { useGroupNotice } from "@/lib/groups";
import { colors, spacing, useTheme } from "@/theme";

type Said = { text: string; tone: "info" | "warning" };

/**
 * The institution's own profile questions, as the web console's Profile fields: moved with up and down buttons (at once,
 * put back if the API refuses), edited in a modal editor, archived after asking, and restored from the archived list.
 */
export default function AdminProfileFieldsScreen() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const router = useRouter();
  const theme = useTheme();
  const qc = useQueryClient();
  const { archived } = useLocalSearchParams<{ archived?: string }>();
  const showArchived = archived === "1";
  const key = adminProfileFieldsKey(slug, showArchived);
  const list = useAdminProfileFields(slug, showArchived);
  const [said, setSaid] = useStatus<Said>();
  const [archiving, setArchiving] = useState<ProfileFieldDto | null>(null);
  // What the editor left on its way back: "Field added" or "Field saved".
  const showNotice = useCallback((text: string) => setSaid({ text, tone: "info" }), [setSaid]);
  useGroupNotice("admin:profile-fields", showNotice);

  const rows = list.data ?? [];
  const active = rows.filter((f) => !f.archivedAt);
  const addField = () => router.push(`/t/${slug}/admin/profile-fields/edit`);
  const editField = (id: string) => router.push(`/t/${slug}/admin/profile-fields/edit?id=${id}`);

  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.admin.profileFields.reorder(slug, ids),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: key });
      const before = qc.getQueryData<ProfileFieldDto[]>(key);
      if (before) qc.setQueryData(key, inFieldOrder(before, ids));
      // The list moved, not whichever one shows when the answer comes.
      return { before, key };
    },
    onError: (err, _ids, context) => {
      if (context?.before) qc.setQueryData(context.key, context.before);
      setSaid({ text: `Couldn't move it: ${errorMessage(err)}`, tone: "warning" });
    },
    onSettled: () => refreshProfileFields(qc, slug),
  });
  const move = (field: ProfileFieldDto, delta: -1 | 1) => {
    const from = active.findIndex((f) => f.id === field.id);
    if (from < 0) return;
    reorder.mutate(moveId(active.map((f) => f.id), from, delta));
    setSaid({ text: `${field.label} moved ${delta < 0 ? "up" : "down"}: ${from + delta + 1} of ${active.length}`, tone: "info" });
  };

  const archive = useMutation({
    mutationFn: (field: ProfileFieldDto) => api.admin.profileFields.archive(slug, field.id),
    onSuccess: () => {
      setArchiving(null);
      setSaid({ text: "Field archived; answers are kept", tone: "info" });
    },
    onSettled: () => refreshProfileFields(qc, slug),
  });
  const restore = useMutation({
    mutationFn: (field: ProfileFieldDto) => api.admin.profileFields.restore(slug, field.id),
    onSuccess: () => setSaid({ text: "Field restored", tone: "info" }),
    // At the limit of active questions, the API says so.
    onError: (err) => setSaid({ text: errorMessage(err), tone: "warning" }),
    onSettled: () => refreshProfileFields(qc, slug),
  });

  const full = active.length >= MAX_PROFILE_FIELDS;
  const add = (
    <Pressable
      onPress={addField}
      disabled={full}
      accessibilityRole="button"
      accessibilityLabel="Add field"
      aria-disabled={full}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 4, minHeight: 44, paddingHorizontal: spacing.md, borderRadius: 22, backgroundColor: pressed ? colors.bg : "transparent", opacity: full ? 0.5 : 1 })}
    >
      <IconPlus size={18} color={theme.primaryInk} />
      <Text style={{ fontSize: 15, fontWeight: "700", color: theme.primaryInk }}>Add field</Text>
    </Pressable>
  );

  return (
    <AdminListScreen title="Profile fields" actions={add}>
      <FlatList
        data={rows}
        // The rows' arrows and Restore follow these as well as the rows.
        extraData={[reorder.isPending, restore.isPending, restore.variables?.id]}
        keyExtractor={(f) => f.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={{ gap: spacing.md }}>
            <Muted size={13}>{profileFieldsSubtitle(active.length)}</Muted>
            {/* Schools don't ask for either. */}
            {tenant.type !== "SCHOOL" && <Muted size={13}>{"Degree and field of study are now built into every profile, so they don't need a question here."}</Muted>}
            <Choice kind="checkbox" label="Show archived fields" checked={showArchived} onPress={() => router.setParams({ archived: showArchived ? undefined : "1" })} />
            <StatusLine flush text={said?.text ?? null} tone={said?.tone} />
          </View>
        }
        ListEmptyComponent={
          <ListEmpty loading={list.isLoading && !list.isFetched} error={list.error} onRetry={() => void list.refetch()}>
            <EmptyState icon={<IconFields size={32} color={colors.faint} />} title="No profile fields yet" description="Add questions members answer when they join and on their profile." />
            <Button title="Add field" style={{ marginTop: spacing.md }} onPress={addField} />
          </ListEmpty>
        }
        renderItem={({ item }) => {
          const i = active.findIndex((f) => f.id === item.id);
          return (
            <FieldRow
              field={item}
              first={i <= 0}
              last={i === active.length - 1}
              reordering={reorder.isPending}
              restoring={restore.isPending && restore.variables?.id === item.id}
              onMove={(delta) => move(item, delta)}
              onEdit={() => editField(item.id)}
              onArchive={() => {
                archive.reset();
                setArchiving(item);
              }}
              onRestore={() => restore.mutate(item)}
            />
          );
        }}
      />
      {archiving && (
        <ConfirmSheet
          open
          {...archiveFieldConfirm(archiving.label)}
          destructive
          busy={archive.isPending}
          error={archive.error ? errorMessage(archive.error) : null}
          onConfirm={() => archive.mutate(archiving)}
          onCancel={() => setArchiving(null)}
        />
      )}
    </AdminListScreen>
  );
}
