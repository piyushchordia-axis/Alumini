import { REPORT_REASONS, REPORT_REASON_LABELS, type ChatConversationDto, type ReportReason } from "@illuminize/shared";
import { CHAT_MUTE_OPTIONS, chatMuteUntil, isMuted, isMutedUntilTurnedOn, type ChatMuteOption } from "@illuminize/shared/chat";
import { isApiClientError } from "@illuminize/shared/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Platform, Text, View } from "react-native";
import { BlockMemberButton } from "@/components/chat/BlockMember";
import { Sheet } from "@/components/chat/ChatFrame";
import { Button, Chip, ErrorText, Input } from "@/components/ui";
import { useNow } from "@/hooks/useChat";
import { api } from "@/lib/api";
import { patchConversation } from "@/lib/chat";
import { formatDateTime } from "@/lib/format";
import { colors, spacing } from "@/theme";

const sectionTitle = { fontSize: 14, fontWeight: "700", color: colors.text } as const;
const sectionText = { fontSize: 14, color: colors.muted } as const;

/**
 * Mute and block for one thread. Reporting is on each message, because a report is about what was said. Blocking asks
 * first, and the screen asks in place of this sheet rather than over it, through `onBlock`.
 */
export function ConversationOptionsSheet({
  slug,
  conversation,
  open,
  onClose,
  onBlock,
  onStatus,
}: {
  slug: string;
  conversation: ChatConversationDto;
  open: boolean;
  onClose: () => void;
  onBlock: () => void;
  /** What changed, for the screen to say. */
  onStatus: (text: string) => void;
}) {
  const qc = useQueryClient();
  const router = useRouter();
  const now = useNow();
  const [choosing, setChoosing] = useState(false);
  // iOS can't show one modal while another is still sliding away, so there the block confirmation waits for this one to go.
  const blockNext = useRef(false);
  const muted = isMuted(conversation, now);
  const mute = useMutation({ mutationFn: (until: string | null) => api.chat.mute(slug, conversation.id, { until }) });
  const close = () => {
    setChoosing(false);
    mute.reset();
    onClose();
  };
  const setMute = (until: string | null) =>
    mute.mutate(until, {
      onSuccess: (updated) => {
        patchConversation(qc, slug, conversation.id, () => updated);
        onStatus(updated.mutedUntil ? "Conversation muted" : "Conversation unmuted");
        close();
      },
    });
  const choose = (option: ChatMuteOption) => setMute(chatMuteUntil(option, new Date()));

  return (
    <Sheet
      open={open}
      title="Conversation options"
      onClose={close}
      onDismiss={() => {
        if (!blockNext.current) return;
        blockNext.current = false;
        onBlock();
      }}
    >
      <View style={{ gap: spacing.sm }}>
        <Text style={sectionTitle}>Notifications</Text>
        {muted ? (
          <>
            <Text style={sectionText}>{isMutedUntilTurnedOn(conversation.mutedUntil) ? "Muted until you turn it back on." : `Muted until ${formatDateTime(conversation.mutedUntil)}.`}</Text>
            <Button title="Unmute conversation" variant="outline" loading={mute.isPending} onPress={() => setMute(null)} />
          </>
        ) : (
          <>
            <Text style={sectionText}>Muting stops notifications from this conversation and leaves it off the Messages badge.</Text>
            <Button title="Mute conversation" variant="outline" aria-expanded={choosing} onPress={() => setChoosing((v) => !v)} />
            {choosing && (
              <View role="group" aria-label="Mute for" style={{ gap: spacing.sm }}>
                {CHAT_MUTE_OPTIONS.map((o) => (
                  <Button key={o.value} title={o.label} variant="ghost" style={{ borderColor: colors.border }} disabled={mute.isPending} onPress={() => choose(o.value)} />
                ))}
              </View>
            )}
          </>
        )}
        <ErrorText error={mute.error} />
      </View>

      {conversation.peer && (
        <View style={{ gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md }}>
          <Text style={sectionTitle}>Safety</Text>
          <Text style={sectionText}>To report something {conversation.peer.fullName} said, tap their message, then Report message.</Text>
          {conversation.blockedByMe ? (
            <BlockMemberButton slug={slug} member={conversation.peer} blocked onChange={() => onStatus(`${conversation.peer?.fullName} is unblocked`)} />
          ) : (
            <Button
              title="Block member"
              variant="danger"
              onPress={() => {
                close();
                if (Platform.OS === "ios") blockNext.current = true;
                else onBlock();
              }}
            />
          )}
        </View>
      )}

      <View style={{ gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md }}>
        <Button
          title="Blocked members"
          variant="ghost"
          accessibilityRole="link"
          onPress={() => {
            close();
            router.push(`/t/${slug}/messages/blocked`);
          }}
        />
        <Button title="Close" variant="outline" onPress={close} />
      </View>
    </Sheet>
  );
}

/** Reports one message. Admins see it with a few messages either side, frozen when it's filed, and nothing else. */
export function ReportMessageSheet({ slug, messageId, onClose, onDone }: { slug: string; messageId: string | null; onClose: () => void; onDone: (text: string) => void }) {
  const [reason, setReason] = useState<ReportReason>("HARASSMENT");
  const [details, setDetails] = useState("");
  const report = useMutation({ mutationFn: (id: string) => api.chat.report(slug, id, { reason, details: details.trim() || null }) });
  const finish = (text: string) => {
    setDetails("");
    report.reset();
    onDone(text);
  };
  const submit = () => {
    if (!messageId) return;
    report.mutate(messageId, {
      onSuccess: () => finish("Thanks. Admins will take a look."),
      onError: (err) => {
        // Already reported (or already removed): the outcome they wanted is in place, so it isn't an error to them.
        if (isApiClientError(err) && err.status === 409) finish(err.message);
      },
    });
  };
  const close = () => {
    if (report.isPending) return;
    setDetails("");
    report.reset();
    onClose();
  };
  return (
    <Sheet open={!!messageId} title="Report message" onClose={close}>
      <Text style={sectionText}>Admins will see this message and up to 10 around it.</Text>
      <View style={{ gap: 6 }}>
        <Text style={{ fontSize: 13, fontWeight: "600", color: "#334155" }}>Reason</Text>
        <View role="group" aria-label="Reason" style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          {REPORT_REASONS.map((r) => (
            <Chip key={r} tall label={REPORT_REASON_LABELS[r]} active={reason === r} onPress={() => setReason(r)} />
          ))}
        </View>
      </View>
      {/* Off, so the web build's browser doesn't keep what's written here for session restore, where it would outlast sign-out. */}
      <Input label="Details (optional)" placeholder="Anything the admins should know?" value={details} onChangeText={setDetails} maxLength={1000} multiline autoComplete="off" />
      <ErrorText error={report.error && !(isApiClientError(report.error) && report.error.status === 409) ? report.error : null} />
      <Button title="Send report" variant="danger" loading={report.isPending} onPress={submit} />
      <Button title="Cancel" variant="ghost" disabled={report.isPending} onPress={close} />
    </Sheet>
  );
}
