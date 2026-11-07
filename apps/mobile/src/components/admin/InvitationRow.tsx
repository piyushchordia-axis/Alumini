import { deliveryText, invitationActionLabel, invitationActionText, invitationActions, invitationMeta, invitationName, invitationStatusView, sendCountText, type InvitationDto, type MessageChannel } from "@illuminize/shared";
import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { IconCopy, IconExternalLink } from "@/components/icons";
import { Badge, Button } from "@/components/ui";
import { formatDateTime, timeAgo } from "@/lib/format";
import { colors, spacing } from "@/theme";

/**
 * One invitation in the console's list: who it's for, its status and how its latest message went, then what can be done
 * with it, each button named for the invitation. `notice` is what just happened to it. `kept`: the row is kept from the
 * search before while this one's answer comes, so its actions wait and its name is said to be busy (the list fades it).
 */
export function InvitationRow({
  inv,
  channels,
  sending,
  kept = false,
  notice,
  onCopy,
  onWhatsApp,
  onSend,
  onRevoke,
}: {
  inv: InvitationDto;
  channels: readonly MessageChannel[];
  sending: boolean;
  kept?: boolean;
  notice?: ReactNode;
  onCopy: () => void;
  onWhatsApp: () => void;
  onSend: () => void;
  onRevoke: () => void;
}) {
  const status = invitationStatusView(inv);
  const can = invitationActions(inv, channels);
  const meta = invitationMeta(inv);
  const delivery = deliveryText(inv, timeAgo);
  const facts = [delivery === "—" ? null : delivery, sendCountText(inv), inv.acceptedAt ? `Joined ${formatDateTime(inv.acceptedAt)}` : null].filter(Boolean).join(" · ");
  const label = (action: Parameters<typeof invitationActionLabel>[0]) => ({ title: invitationActionText(action, inv), accessibilityLabel: invitationActionLabel(action, inv) });
  return (
    <View role="article" style={styles.row}>
      <View style={styles.nameLine}>
        <Text numberOfLines={1} aria-busy={kept || undefined} style={styles.name}>
          {invitationName(inv)}
        </Text>
        <Badge label={status.label} tone={status.tone} />
      </View>
      {meta ? <Text style={styles.meta}>{meta}</Text> : null}
      {facts ? <Text style={styles.facts}>{facts}</Text> : null}
      {(can.copy || can.whatsapp || can.send || can.revoke) && (
        <View style={styles.actions}>
          {can.copy && <Button {...label("copy")} size="compact" variant="outline" disabled={kept} icon={(c) => <IconCopy size={16} color={c} />} onPress={onCopy} />}
          {can.whatsapp && <Button {...label("whatsapp")} size="compact" variant="outline" disabled={kept} icon={(c) => <IconExternalLink size={16} color={c} />} onPress={onWhatsApp} />}
          {can.send && <Button {...label("send")} size="compact" variant="outline" disabled={kept} loading={sending} onPress={onSend} />}
          {can.revoke && <Button {...label("revoke")} size="compact" variant="ghost" disabled={kept || sending} onPress={onRevoke} />}
        </View>
      )}
      {notice}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { backgroundColor: colors.card, paddingHorizontal: spacing.lg, paddingVertical: 10, gap: 4 },
  nameLine: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  name: { flexShrink: 1, fontSize: 14, fontWeight: "600", color: colors.text },
  meta: { fontSize: 12, color: colors.muted, fontVariant: ["tabular-nums"] },
  facts: { fontSize: 12, color: colors.muted },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.xs },
});
