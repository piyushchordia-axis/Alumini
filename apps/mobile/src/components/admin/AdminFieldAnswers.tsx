import { answersToValues, fieldErrorsFrom, type AdminMemberDetailDto, type AdminMemberDto } from "@illuminize/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState, type ComponentRef, type Ref } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { CustomFieldInputs, type FieldAnswers } from "@/components/CustomFieldInputs";
import { StatusLine } from "@/components/Sheet";
import { Badge, Button, Card, ErrorText, Muted, headingRole } from "@/components/ui";
import { useStatus } from "@/hooks/useStatus";
import { adminSectionHref } from "@/lib/admin";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { colors, spacing, useTheme } from "@/theme";

/**
 * A member's answers to the institution's questions, which an admin can edit, the admin-managed ones included. Editing
 * starts from the answers saved when Edit is pressed, so a refetch never overwrites what's being typed, and Cancel puts
 * them back. `onEdit` hears the editor open, and `cardRef` reaches the card, to bring it into view.
 */
export function AdminFieldAnswers({ slug, member, onEdit, cardRef }: { slug: string; member: AdminMemberDto; onEdit?: () => void; cardRef?: Ref<ComponentRef<typeof View>> }) {
  const qc = useQueryClient();
  const router = useRouter();
  const theme = useTheme();
  const fields = useQuery({ queryKey: qk.admin.profileFields(slug), queryFn: () => api.admin.profileFields.list(slug) });
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<FieldAnswers>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [said, say] = useStatus();
  const save = useMutation({
    mutationFn: (answers: FieldAnswers) => api.admin.members.updateProfile(slug, member.id, { fields: answers }),
    onSuccess: (saved) => {
      // The answers as saved at once, so the read view doesn't show the old ones until the refetch.
      qc.setQueryData<AdminMemberDetailDto>(qk.admin.member(slug, member.id), (old) => (old ? { ...old, ...saved } : old));
      setEditing(false);
      say("Answers saved");
    },
    onError: (err) => setErrors(fieldErrorsFrom(err, "fields.")),
    // The members list and the member's own profile show answers too.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.admin.member(slug, member.id) });
      void qc.invalidateQueries({ queryKey: ["admin", slug, "members"] });
      void qc.invalidateQueries({ queryKey: qk.member(slug, member.id) });
    },
  });
  const defs = fields.data ?? [];
  // Only the first answer is waited for: a refetch mustn't swap an open editor for nothing.
  if ((fields.isLoading && !fields.isFetched) || defs.length === 0) return null;
  const edit = () => {
    setValues(answersToValues(member.fields));
    setErrors({});
    save.reset();
    setEditing(true);
    onEdit?.();
  };
  const cancel = () => {
    setValues(answersToValues(member.fields));
    setErrors({});
    save.reset();
    setEditing(false);
  };
  // Profile fields, where the questions are managed: its screen here, or its name on the web console if it's only there.
  const fieldsHref = adminSectionHref(slug, "profileFields");
  // A failure that isn't about one answer, shown under the buttons.
  const failure = save.error && Object.keys(fieldErrorsFrom(save.error, "fields.")).length === 0 ? save.error : null;
  return (
    <View ref={cardRef}>
      <Card style={{ gap: spacing.md }}>
        <View style={styles.header}>
          <Text {...headingRole(2)} style={styles.heading}>
            Profile questions
          </Text>
          {!editing && <Button size="compact" variant="outline" title="Edit answers" onPress={edit} />}
        </View>
        {editing ? (
          <>
            <CustomFieldInputs fields={defs} values={values} errors={errors} audience="admin" onChange={(key, value) => setValues((s) => ({ ...s, [key]: value }))} />
            <Button title="Save answers" loading={save.isPending} onPress={() => save.mutate(values)} />
            <Button title="Cancel" variant="ghost" disabled={save.isPending} onPress={cancel} />
            <ErrorText error={failure} />
          </>
        ) : (
          <View style={{ gap: spacing.md }}>
            {defs.map((f) => {
              const answer = member.fields.find((a) => a.key === f.key);
              return (
                <View key={f.key} style={{ gap: 2 }}>
                  <View style={styles.labelRow}>
                    <Text style={styles.label}>{f.label}</Text>
                    {f.visibility === "ADMINS" && <Badge label="Admins only" />}
                  </View>
                  <Text selectable style={styles.value}>
                    {answer?.display || "—"}
                  </Text>
                </View>
              );
            })}
          </View>
        )}
        <StatusLine text={said} flush />
        {fieldsHref ? (
          <Pressable onPress={() => router.push(fieldsHref)} accessibilityRole="link" style={({ pressed }) => [styles.manage, pressed ? { opacity: 0.6 } : null]}>
            <Text style={{ fontSize: 13, color: theme.primaryInk }}>Manage the questions under Profile fields</Text>
          </Pressable>
        ) : (
          <Muted>Manage the questions under Profile fields on the web console.</Muted>
        )}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, flexWrap: "wrap" },
  heading: { fontSize: 15, fontWeight: "700", color: colors.text },
  labelRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  label: { fontSize: 12, color: colors.muted },
  value: { fontSize: 14, color: colors.text },
  manage: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
});
