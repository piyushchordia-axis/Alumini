import { memberListMeta, type AdminMemberDto } from "@illuminize/shared";
import { StyleSheet, Text, View } from "react-native";
import { MemberActionButtons } from "@/components/admin/MemberActionButtons";
import { MemberStatusBadge } from "@/components/admin/MemberStatusBadge";
import { Avatar, Badge } from "@/components/ui";
import type { MemberActions } from "@/hooks/useMemberActions";
import { formatDate } from "@/lib/format";
import { colors, spacing } from "@/theme";

/**
 * One member of the console's list: who they are, then what can be done, as a row of its own beneath, never inside
 * something pressable. The admin's own row has no actions, as the API refuses them. `disabled` holds the actions while the
 * rows on screen are a previous search's.
 */
export function AdminMemberRow({ member, actions, you, disabled = false }: { member: AdminMemberDto; actions: MemberActions; you: boolean; disabled?: boolean }) {
  return (
    <View style={styles.row}>
      <View style={styles.who}>
        <Avatar name={member.fullName} src={member.avatarUrl} size={AVATAR} />
        <View style={styles.text}>
          <View style={styles.nameLine}>
            <Text numberOfLines={1} style={styles.name}>
              {member.fullName}
            </Text>
            {member.role === "TENANT_ADMIN" && <Badge label="Admin" tone="primary" />}
            <MemberStatusBadge status={member.status} />
          </View>
          <Text numberOfLines={2} style={styles.meta}>
            {memberListMeta(member, formatDate)}
          </Text>
          {member.statusReason ? (
            <Text numberOfLines={2} style={styles.reason}>
              Reason: {member.statusReason}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={styles.actions}>{you ? <Text style={styles.you}>You</Text> : <MemberActionButtons member={member} actions={actions} disabled={disabled} />}</View>
    </View>
  );
}

const AVATAR = 40;

const styles = StyleSheet.create({
  row: { backgroundColor: colors.card, paddingHorizontal: spacing.lg, paddingVertical: 10, gap: spacing.sm },
  // Under the name, clear of the avatar.
  actions: { paddingLeft: AVATAR + spacing.md },
  who: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  text: { flex: 1, minWidth: 0, gap: 2 },
  nameLine: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  name: { flexShrink: 1, fontSize: 15, fontWeight: "600", color: colors.text },
  meta: { fontSize: 12, color: colors.muted },
  reason: { fontSize: 12, color: colors.muted },
  you: { fontSize: 13, color: colors.muted },
});
