import {
  CHAT_REPORT_MESSAGE_GONE_TEXT,
  CHAT_REPORT_TARGET_KIND_LABELS,
  CHAT_REPORT_VIEW_HINT,
  REPORT_REASON_LABELS,
  chatReportActionLabel,
  chatReportActionsFor,
  chatReportHeadline,
  chatReportMemberLinkText,
  chatReportSenderLabel,
  chatReportViewLabel,
  type AdminChatReportDto,
  type AdminChatReportMessageDto,
  type AdminChatReportViewDto,
  type ChatReportCloseAction,
} from "@illuminize/shared";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { IconChevronRight } from "@/components/icons";
import { StatusLine } from "@/components/Sheet";
import { Badge, Button, Card } from "@/components/ui";
import { formatDateTime, timeAgo } from "@/lib/format";
import { colors, radius, spacing, useTheme } from "@/theme";

const VARIANT: Readonly<Record<ChatReportCloseAction, "danger" | "outline" | "ghost">> = { remove: "danger", resolve: "outline", dismiss: "ghost" };

/**
 * A reported message with the messages around it, oldest first, as they read in the thread. The reported one is marked
 * by a badge as well as its colour. The words can't be selected, so the phone's copy menu never offers them.
 */
export function ReportedMessages({ messages }: { messages: AdminChatReportMessageDto[] }) {
  if (messages.length === 0) return <Text style={styles.gone}>{CHAT_REPORT_MESSAGE_GONE_TEXT}</Text>;
  return (
    <View role="list" aria-label="The reported message and the messages around it, oldest first" style={styles.thread}>
      {messages.map((m) => (
        <View key={m.id} role="listitem" style={[styles.message, m.isTarget ? styles.target : null]}>
          <View style={styles.messageHead}>
            <Text style={styles.sender}>{chatReportSenderLabel(m)}</Text>
            <Text style={styles.time}>{formatDateTime(m.createdAt)}</Text>
            {m.isTarget && <Badge label="Reported message" tone="danger" />}
            {m.removed && <Badge label="Removed" />}
          </View>
          <Text selectable={false} style={styles.body}>
            {m.body}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * One chat report. Closed, it says who reported whom, why and when, and no words, with the button that opens it and the
 * reminder that each view is audited. Open (`view`, for one report on the screen at a time), it shows the reporter's
 * note, the messages or the reported request, a way to the reported member's page, and on an open report the ways to
 * close it, each asking for a note through the screen's sheet (`onAsk`).
 */
export function ChatReportRow({
  report,
  view,
  opening,
  problem,
  onView,
  onHide,
  onAsk,
  onOpenMember,
}: {
  report: AdminChatReportDto;
  view: AdminChatReportViewDto | null;
  opening: boolean;
  problem: string | null;
  onView: () => void;
  onHide: () => void;
  onAsk: (action: ChatReportCloseAction) => void;
  onOpenMember: (membershipId: string) => void;
}) {
  const theme = useTheme();
  const reported = report.reported;
  return (
    <Card style={styles.card}>
      <View style={styles.badges}>
        <Badge label={REPORT_REASON_LABELS[report.reason]} tone="danger" />
        <Badge label={CHAT_REPORT_TARGET_KIND_LABELS[report.targetKind]} tone="info" />
        {report.resolutionAction === "REMOVE_MESSAGE" && <Badge label="Message removed" />}
      </View>
      <Text style={styles.meta}>
        {chatReportHeadline(report)} · {timeAgo(report.createdAt)}
      </Text>
      {view ? (
        <View style={styles.open}>
          {view.details ? (
            <Text selectable={false} style={styles.note}>
              <Text style={styles.strong}>{"Reporter's note:"}</Text> {view.details}
            </Text>
          ) : null}
          {report.targetKind === "MESSAGE" ? (
            <ReportedMessages messages={view.messages} />
          ) : (
            <View style={[styles.message, styles.target]}>
              <Text selectable={false} style={styles.body}>
                {view.noteSnapshot}
              </Text>
            </View>
          )}
          {view.resolutionNote ? (
            <Text selectable={false} style={styles.meta}>
              Resolution: {view.resolutionNote}
            </Text>
          ) : null}
          {reported && (
            <View>
              <Text style={styles.meta}>To suspend them, open</Text>
              <Pressable onPress={() => onOpenMember(reported.id)} accessibilityRole="link" style={({ pressed }) => [styles.link, pressed ? { opacity: 0.6 } : null]}>
                <Text style={[styles.linkText, { color: theme.primaryInk }]}>{chatReportMemberLinkText(reported)}</Text>
                <IconChevronRight size={14} color={theme.primaryInk} />
              </Pressable>
            </View>
          )}
          <View style={styles.actions}>
            {chatReportActionsFor(report).map((action) => (
              <Button key={action} size="compact" variant={VARIANT[action]} title={chatReportActionLabel(action, report.targetKind)} onPress={() => onAsk(action)} />
            ))}
            <Button size="compact" variant="ghost" title="Hide" onPress={onHide} />
          </View>
        </View>
      ) : (
        <View style={styles.closed}>
          <Button size="compact" variant="outline" title={chatReportViewLabel(report.targetKind)} loading={opening} onPress={onView} />
          <Text style={styles.hint}>{CHAT_REPORT_VIEW_HINT}</Text>
        </View>
      )}
      <StatusLine flush text={problem} tone="warning" />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md, gap: spacing.sm },
  badges: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  meta: { fontSize: 12, color: colors.muted },
  closed: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
  hint: { flexShrink: 1, fontSize: 12, color: colors.muted },
  open: { gap: spacing.md },
  note: { fontSize: 14, color: "#334155" },
  strong: { fontWeight: "700" },
  thread: { gap: spacing.sm },
  message: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, gap: 4, backgroundColor: colors.card },
  target: { borderColor: "#fca5a5", backgroundColor: "#fef2f2" },
  messageHead: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  sender: { fontSize: 13, fontWeight: "700", color: colors.text },
  time: { fontSize: 12, color: colors.muted },
  body: { fontSize: 14, lineHeight: 20, color: "#1e293b" },
  gone: { fontSize: 14, fontStyle: "italic", color: colors.muted },
  link: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 4, minHeight: 44 },
  linkText: { fontSize: 14, fontWeight: "600" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});
