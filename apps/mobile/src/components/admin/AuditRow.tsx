import { auditActorLabel, auditDetailLines, auditTargetLabel, type AuditDto } from "@illuminize/shared";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { IconChevronRight } from "@/components/icons";
import { Badge } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { colors, spacing, useTheme } from "@/theme";

/** How many of a row's detail lines show. */
const DETAIL_LINES = 4;

/**
 * One row of the audit log, on its page and on a member's: the action as recorded, when, who did it, what it was done
 * to, and its details as readable lines (auditDetailLines, which never shows a private key such as a phone hash). A
 * membership target opens that member's page through `onOpenMember`, unless it is `selfId`, the page already open.
 */
export function AuditRow({ entry, onOpenMember, selfId }: { entry: AuditDto; onOpenMember?: (membershipId: string) => void; selfId?: string }) {
  const theme = useTheme();
  const target = auditTargetLabel(entry);
  const lines = auditDetailLines(entry.metadata).slice(0, DETAIL_LINES);
  const memberId = target.membershipId && target.membershipId !== selfId ? target.membershipId : undefined;
  return (
    <View style={styles.row}>
      <View style={styles.top}>
        <View style={styles.action}>
          <Badge label={entry.action} />
        </View>
        <Text style={styles.when}>{formatDateTime(entry.createdAt)}</Text>
      </View>
      <Text style={styles.actor}>{auditActorLabel(entry)}</Text>
      {memberId && onOpenMember ? (
        <Pressable
          onPress={() => onOpenMember(memberId)}
          accessibilityRole="link"
          accessibilityHint="Opens this member's page in the console"
          style={({ pressed }) => [styles.link, pressed ? { opacity: 0.6 } : null]}
        >
          <Text style={[styles.target, { color: theme.primaryInk }]}>{target.text}</Text>
          <IconChevronRight size={14} color={theme.primaryInk} />
        </Pressable>
      ) : (
        <Text style={[styles.target, { color: colors.muted }]}>{target.text}</Text>
      )}
      {lines.map((line, i) => (
        <Text key={i} numberOfLines={2} style={styles.detail}>
          {line}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { backgroundColor: colors.card, paddingHorizontal: spacing.lg, paddingVertical: 10, gap: 2 },
  top: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.sm },
  action: { flexShrink: 1, flexDirection: "row" },
  when: { flexShrink: 0, fontSize: 12, color: colors.muted },
  actor: { fontSize: 13, color: colors.text, marginTop: 2 },
  link: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 44, alignSelf: "flex-start" },
  target: { fontSize: 13 },
  detail: { fontSize: 12, color: colors.muted },
});
