import { CHAT_MESSAGE_MAX_LENGTH } from "@illuminize/shared";
import { useState } from "react";
import { ActivityIndicator, Platform, Pressable, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useKeyboardVisible } from "@/hooks/useChat";
import { useChatStore } from "@/stores/chatStore";
import { colors, radius, spacing, useTheme } from "@/theme";

const MIN_HEIGHT = 44;
/** About five lines, then it scrolls. */
const MAX_HEIGHT = 132;
/** The count appears this close to the limit, not before, when it would only be noise. */
const SHOW_COUNT_FROM = CHAT_MESSAGE_MAX_LENGTH - 500;

/**
 * The message box. Its text is the draft for `draftKey`, held in memory only, so it survives leaving the thread, a failed
 * send and a failed refetch, and goes with sign-out. Return makes a new line, as on any touch keyboard, so it never sends in
 * the middle of an IME composition. The caller decides when a send clears it.
 */
export function ChatComposer({ draftKey, onSend, sending = false, notice }: { draftKey: string; onSend: (text: string) => void; sending?: boolean; notice?: string | null }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();
  const draft = useChatStore((s) => s.drafts[draftKey] ?? "");
  const setDraft = useChatStore((s) => s.setDraft);
  // A phone's multiline box grows by itself up to maxHeight. A browser's doesn't, so the web export sizes it from its content.
  const [webHeight, setWebHeight] = useState(MIN_HEIGHT);
  const empty = draft.trim().length === 0;
  const send = () => {
    if (empty || sending) return;
    onSend(draft.trim());
    setWebHeight(MIN_HEIGHT);
  };

  return (
    // The safe area at the bottom of a phone is behind the keyboard while it's up, so it would only leave a gap.
    <View style={{ borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.card, paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: keyboardVisible ? spacing.sm : Math.max(insets.bottom, spacing.sm) }}>
      {notice ? (
        <View role="status" accessibilityLiveRegion="polite" style={{ marginBottom: spacing.sm, borderRadius: radius.md, backgroundColor: "#fef3c7", paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
          <Text style={{ fontSize: 13, color: "#92400e" }}>{notice}</Text>
        </View>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: spacing.sm }}>
        <TextInput
          accessibilityLabel="Write a message"
          placeholder="Write a message"
          placeholderTextColor={colors.faint}
          multiline
          // Off: on the web build the browser would otherwise keep the draft for session restore, on disk, past sign-out.
          autoComplete="off"
          value={draft}
          maxLength={CHAT_MESSAGE_MAX_LENGTH}
          onChangeText={(text) => {
            setDraft(draftKey, text);
            if (!text) setWebHeight(MIN_HEIGHT);
          }}
          onContentSizeChange={Platform.OS === "web" ? (e) => setWebHeight(Math.min(Math.max(e.nativeEvent.contentSize.height, MIN_HEIGHT), MAX_HEIGHT)) : undefined}
          textAlignVertical="top"
          style={[
            { flex: 1, minHeight: MIN_HEIGHT, maxHeight: MAX_HEIGHT, borderWidth: 1, borderColor: colors.border, borderRadius: 22, backgroundColor: colors.card, paddingHorizontal: spacing.lg, paddingTop: 11, paddingBottom: 11, fontSize: 15, lineHeight: 20, color: colors.text },
            Platform.OS === "web" ? { height: webHeight } : null,
          ]}
        />
        <Pressable
          onPress={send}
          disabled={empty || sending}
          accessibilityRole="button"
          accessibilityLabel="Send message"
          aria-disabled={empty || sending}
          aria-busy={sending}
          style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: theme.primary, opacity: empty || sending ? 0.4 : pressed ? 0.8 : 1 })}
        >
          {sending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text accessible={false} style={{ color: "#fff", fontSize: 18, lineHeight: 20 }}>
              ➤
            </Text>
          )}
        </Pressable>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: spacing.sm, paddingTop: spacing.xs }}>
        <Text style={{ flex: 1, fontSize: 11, color: colors.muted }}>{"Text only. Photos and files aren't supported in chat."}</Text>
        {draft.length >= SHOW_COUNT_FROM ? (
          <Text style={{ fontSize: 11, fontVariant: ["tabular-nums"], color: draft.length >= CHAT_MESSAGE_MAX_LENGTH ? colors.danger : colors.muted, fontWeight: draft.length >= CHAT_MESSAGE_MAX_LENGTH ? "600" : "400" }}>
            {draft.length.toLocaleString()} / {CHAT_MESSAGE_MAX_LENGTH.toLocaleString()}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
