import { peerName, type ChatRow } from "@illuminize/shared/chat";
import { memo } from "react";
import { Pressable, Text, View } from "react-native";
import { colors, radius, spacing, useTheme } from "@/theme";

type MessageRowData = Extract<ChatRow, { type: "message" }>;

export interface MessageActions {
  onRetry: (clientKey: string) => void;
  onDiscard: (clientKey: string) => void;
  onReport: (messageId: string) => void;
}

const REMOVED = "This message was removed";

/** A day's label between messages. */
export function DayRow({ label }: { label: string }) {
  return (
    <View style={{ alignItems: "center", marginVertical: spacing.md }}>
      <View style={{ backgroundColor: "#e2e8f0", borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: 2 }}>
        <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted }}>{label}</Text>
      </View>
    </View>
  );
}

/**
 * One message. Text is shown as text and nothing else: no links, no markdown, line breaks kept, long unbroken strings
 * wrapped. Tapping it shows its time and, for someone else's message, Report message; screen readers get the report as an
 * action on the message itself.
 */
export const MessageRow = memo(function MessageRow({ row, actions, selected, onSelect }: { row: MessageRowData; actions: MessageActions; selected: boolean; onSelect: () => void }) {
  const theme = useTheme();
  const { item, mine, startsGroup, endsGroup, timeLabel } = row;
  const message = item.message;
  const pending = item.pending;

  if (message?.kind === "SYSTEM") {
    return (
      <Text style={{ textAlign: "center", fontSize: 12, color: colors.muted, marginVertical: spacing.md, paddingHorizontal: spacing.lg }}>
        {message.body} <Text style={{ color: colors.faint }}>· {timeLabel}</Text>
      </Text>
    );
  }

  const removed = !!message?.removed;
  const failed = pending?.status === "failed";
  const reportable = !!message && !mine && !removed;
  const who = mine ? "You" : peerName(message?.sender);
  const text = removed ? REMOVED : (message?.body ?? pending?.body ?? "");
  const state = pending ? (failed ? "not sent" : "sending") : timeLabel;

  return (
    <View style={{ alignItems: mine ? "flex-end" : "flex-start", marginTop: startsGroup ? spacing.md : 2, paddingHorizontal: spacing.md }}>
      <Pressable
        onPress={onSelect}
        accessibilityLabel={`${who}: ${text}, ${state}`}
        accessibilityHint={reportable ? "Shows the time and Report message" : "Shows the time"}
        accessibilityActions={reportable ? [{ name: "report", label: "Report message" }] : undefined}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === "report" && message) actions.onReport(message.id);
        }}
        style={[
          // At least 44 points tall, because tapping a bubble is the way to Report message.
          { maxWidth: "85%", minHeight: 44, justifyContent: "center", borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8 },
          removed
            ? { borderWidth: 1, borderStyle: "dashed", borderColor: "#cbd5e1", backgroundColor: colors.card }
            : mine
              ? { backgroundColor: theme.primary, opacity: pending && !failed ? 0.7 : 1, borderWidth: failed ? 2 : 0, borderColor: colors.danger }
              : { backgroundColor: "#e2e8f0" },
          endsGroup ? (mine ? { borderBottomRightRadius: 6 } : { borderBottomLeftRadius: 6 }) : null,
        ]}
      >
        <Text selectable={!removed} style={{ fontSize: 15, lineHeight: 21, color: removed ? colors.muted : mine ? "#fff" : colors.text, fontStyle: removed ? "italic" : "normal" }}>
          {text}
        </Text>
      </Pressable>
      {pending ? (
        failed ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", columnGap: spacing.xs }}>
            <Text role="alert" style={{ fontSize: 12, color: colors.danger, paddingHorizontal: spacing.xs }}>
              Not sent{pending.error ? `: ${pending.error}` : ""}
            </Text>
            <Pressable onPress={() => actions.onRetry(pending.clientKey)} accessibilityRole="button" accessibilityLabel="Try again" style={smallButton}>
              <Text style={{ fontSize: 13, fontWeight: "700", color: theme.primary }}>Try again</Text>
            </Pressable>
            <Pressable onPress={() => actions.onDiscard(pending.clientKey)} accessibilityRole="button" accessibilityLabel="Discard" style={smallButton}>
              <Text style={{ fontSize: 13, color: colors.muted }}>Discard</Text>
            </Pressable>
          </View>
        ) : (
          <Text style={{ fontSize: 11, color: colors.faint, marginTop: 2, paddingHorizontal: spacing.xs }}>Sending…</Text>
        )
      ) : selected ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Text style={{ fontSize: 11, color: colors.faint, paddingHorizontal: spacing.xs }}>{timeLabel}</Text>
          {reportable && (
            <Pressable onPress={() => actions.onReport(message.id)} accessibilityRole="button" accessibilityLabel="Report message" style={smallButton}>
              <Text style={{ fontSize: 13, fontWeight: "600", color: colors.danger }}>Report message</Text>
            </Pressable>
          )}
        </View>
      ) : endsGroup ? (
        <Text style={{ fontSize: 11, color: colors.faint, marginTop: 2, paddingHorizontal: spacing.xs }}>{timeLabel}</Text>
      ) : null}
    </View>
  );
});

const smallButton = { minHeight: 44, minWidth: 44, justifyContent: "center", alignItems: "center", paddingHorizontal: spacing.sm } as const;
