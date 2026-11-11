import { attachmentA11yText, CHAT_FILE_DEFAULT_NAME, fileOpenLabel, messageSenderName, PHOTO_GRID_WIDTH, photoOpenLabel, systemLineText, type ChatRow } from "@illuminize/shared/chat";
import { memo } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { MessageAttachments, PendingAttachments, useOpenAttachment } from "@/components/chat/MessageAttachments";
import type { Focusable } from "@/components/ui";
import { colors, radius, spacing, useTheme } from "@/theme";

type MessageRowData = Extract<ChatRow, { type: "message" }>;

export interface MessageActions {
  onRetry: (clientKey: string) => void;
  onDiscard: (clientKey: string) => void;
  onReport: (messageId: string) => void;
  /** Opens the viewer on a message's photo `index` (among its photos); `opener` takes focus back when it closes. */
  onOpenPhoto: (messageId: string, index: number, opener: Focusable | null) => void;
  /** Something about a photo or file went wrong, for the screen to say. */
  onProblem: (text: string) => void;
}

/** The bubble's padding around its photos and files. */
const MEDIA_INSET = 4;

const REMOVED = "This message was removed";
const HIDDEN = "Hidden because you blocked this member";

/**
 * A day's label between messages. Its chip is slate-200, to stand apart from the chat's slate-100 page, where the meta
 * grey falls under 4.5:1: the secondary grey, as on the Tabs tray.
 */
export function DayRow({ label }: { label: string }) {
  return (
    <View style={{ alignItems: "center", marginVertical: spacing.md }}>
      <View style={{ backgroundColor: "#e2e8f0", borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: 2 }}>
        <Text style={{ fontSize: 12, fontWeight: "600", color: colors.secondary }}>{label}</Text>
      </View>
    </View>
  );
}

/**
 * One message. Text is shown as text and nothing else: no links, no markdown, line breaks kept, long unbroken strings
 * wrapped. Photos and files sit above the words. Tapping it, or holding a photo or file, shows its time and, for someone
 * else's message, Report message; screen readers hear the photos and files counted, and get reporting and opening each
 * one as actions on the message itself.
 */
export const MessageRow = memo(function MessageRow({
  slug,
  conversationId,
  row,
  me,
  showSenders = false,
  actions,
  selected,
  onSelect,
}: {
  slug: string;
  conversationId: string;
  row: MessageRowData;
  /** This member's id, so a system line about them reads "You". */
  me: string;
  /** In a group, where there are more than two people, each run of messages says whose it is. */
  showSenders?: boolean;
  actions: MessageActions;
  selected: boolean;
  onSelect: () => void;
}) {
  const theme = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const { opening, open: openFile } = useOpenAttachment(slug, conversationId, actions.onProblem);
  const { item, mine, startsGroup, endsGroup, timeLabel } = row;
  const message = item.message;
  const pending = item.pending;

  if (message?.kind === "SYSTEM") {
    // A group's lines are about one member and name nobody themselves, so the name goes in front.
    const line = showSenders ? systemLineText(message, !message.redacted && message.sender?.id === me) : message.body;
    return (
      <Text style={{ textAlign: "center", fontSize: 12, color: colors.muted, marginVertical: spacing.md, paddingHorizontal: spacing.lg }}>
        {line} · {timeLabel}
      </Text>
    );
  }

  const removed = !!message?.removed;
  // Someone this member blocked, in a group: nothing they wrote, and no name beyond "Blocked member".
  const hidden = !!message?.redacted && !removed;
  const failed = pending?.status === "failed";
  const reportable = !!message && !mine && !removed && !message.redacted;
  const who = mine ? "You" : message ? messageSenderName(message) : "";
  const text = removed ? REMOVED : hidden ? HIDDEN : (message?.body ?? pending?.body ?? "");
  const muted = removed || hidden;
  const state = pending ? (failed ? "not sent" : "sending") : timeLabel;
  // A removed or hidden message's DTO has none; a send still going shows its previews from this device.
  const attachments = muted ? [] : (message?.attachments ?? pending?.attachments ?? []);
  const hasMedia = attachments.length > 0;
  // As wide as a photo grid gets, within the bubble's 85% of the row.
  const mediaWidth = Math.min(PHOTO_GRID_WIDTH, Math.floor((windowWidth - spacing.md * 2) * 0.85) - MEDIA_INSET * 2);
  const summary = attachmentA11yText(attachments);
  const spoken = summary ? (text ? `${summary} ${text}` : summary.replace(/\.$/, "")) : text;
  const photos = attachments.filter((a) => a.kind === "PHOTO");
  const files = attachments.filter((a) => a.kind === "FILE");
  // iOS reads the bubble as one element, so its photo and file buttons can't be reached there: it offers them as actions.
  const mediaActions = message && hasMedia ? [...photos.map((_, i) => ({ name: `photo:${i}`, label: photoOpenLabel(i, photos.length) })), ...files.map((f) => ({ name: `file:${f.id}`, label: fileOpenLabel(f.name ?? CHAT_FILE_DEFAULT_NAME) }))] : [];
  const a11yActions = [...(reportable ? [{ name: "report", label: "Report message" }] : []), ...mediaActions];

  return (
    <View style={{ alignItems: mine ? "flex-end" : "flex-start", marginTop: startsGroup ? spacing.md : 2, paddingHorizontal: spacing.md }}>
      {showSenders && !mine && startsGroup && (
        // The bubble's own name says who for screen readers.
        <Text accessible={false} aria-hidden numberOfLines={1} style={{ maxWidth: "85%", fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 2, paddingHorizontal: spacing.xs }}>
          {who}
        </Text>
      )}
      <Pressable
        onPress={onSelect}
        accessibilityLabel={`${who}: ${spoken}, ${state}`}
        accessibilityHint={reportable ? "Shows the time and Report message" : "Shows the time"}
        accessibilityActions={a11yActions.length ? a11yActions : undefined}
        onAccessibilityAction={(e) => {
          const name = e.nativeEvent.actionName;
          if (!message) return;
          if (name === "report") actions.onReport(message.id);
          else if (name.startsWith("photo:")) actions.onOpenPhoto(message.id, Number(name.slice(6)), null);
          else if (name.startsWith("file:")) {
            const file = files.find((f) => f.id === name.slice(5));
            if (file) void openFile(message.id, file);
          }
        }}
        style={[
          // At least 44 points tall, because tapping a bubble is the way to Report message.
          { maxWidth: "85%", minHeight: 44, justifyContent: "center", borderRadius: 18 },
          hasMedia ? { width: mediaWidth + MEDIA_INSET * 2, padding: MEDIA_INSET } : { paddingHorizontal: 14, paddingVertical: 8 },
          muted
            ? { borderWidth: 1, borderStyle: "dashed", borderColor: "#cbd5e1", backgroundColor: colors.card }
            : mine
              ? { backgroundColor: theme.primary, opacity: pending && !failed ? 0.7 : 1, borderWidth: failed ? 2 : 0, borderColor: colors.danger }
              : { backgroundColor: "#e2e8f0" },
          endsGroup ? (mine ? { borderBottomRightRadius: 6 } : { borderBottomLeftRadius: 6 }) : null,
        ]}
      >
        {hasMedia &&
          (message ? (
            <MessageAttachments
              slug={slug}
              conversationId={conversationId}
              message={message}
              width={mediaWidth}
              opening={opening}
              onOpenPhoto={actions.onOpenPhoto}
              onOpenFile={(file) => void openFile(message.id, file)}
              onLongPress={onSelect}
            />
          ) : (
            <PendingAttachments attachments={pending?.attachments ?? []} width={mediaWidth} />
          ))}
        {text ? (
          <Text
            selectable={!muted}
            style={[
              { fontSize: 15, lineHeight: 21, color: muted ? colors.muted : mine ? theme.onPrimary : colors.text, fontStyle: muted ? "italic" : "normal" },
              hasMedia ? { paddingHorizontal: 10, paddingTop: 6, paddingBottom: 4 } : null,
            ]}
          >
            {text}
          </Text>
        ) : null}
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
          <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2, paddingHorizontal: spacing.xs }}>Sending…</Text>
        )
      ) : selected ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Text style={{ fontSize: 11, color: colors.muted, paddingHorizontal: spacing.xs }}>{timeLabel}</Text>
          {reportable && (
            <Pressable onPress={() => actions.onReport(message.id)} accessibilityRole="button" accessibilityLabel="Report message" style={smallButton}>
              <Text style={{ fontSize: 13, fontWeight: "600", color: colors.danger }}>Report message</Text>
            </Pressable>
          )}
        </View>
      ) : endsGroup ? (
        <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2, paddingHorizontal: spacing.xs }}>{timeLabel}</Text>
      ) : null}
    </View>
  );
});

const smallButton = { minHeight: 44, minWidth: 44, justifyContent: "center", alignItems: "center", paddingHorizontal: spacing.sm } as const;
