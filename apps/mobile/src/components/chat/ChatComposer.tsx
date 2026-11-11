import { CHAT_ATTACHMENT_LIMIT_TEXT, CHAT_MESSAGE_MAX_LENGTH } from "@illuminize/shared";
import { CHAT_ATTACH_FAILED_TEXT, CHAT_ATTACH_LABEL, trayFull, traySendable, trayStatusText, type TrayItem } from "@illuminize/shared/chat";
import { useEffect, useId, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Platform, Pressable, Text, TextInput, View, type TextInputInstance } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AttachSheet, type AttachChoice } from "@/components/chat/AttachSheet";
import { AttachmentTray } from "@/components/chat/AttachmentTray";
import { IconAlert, IconPaperclip, IconSend } from "@/components/icons";
import { StatusLine } from "@/components/Sheet";
import { describedBy, focusOn, Notice, type Focusable } from "@/components/ui";
import { useKeyboardVisible } from "@/hooks/useChat";
import { heldState } from "@/lib/a11y";
import { useChatStore } from "@/stores/chatStore";
import { colors, spacing, useTheme } from "@/theme";

const MIN_HEIGHT = 44;
/** About five lines, then it scrolls. */
const MAX_HEIGHT = 132;
/** The count appears this close to the limit, not before, when it would only be noise. */
const SHOW_COUNT_FROM = CHAT_MESSAGE_MAX_LENGTH - 500;
const NO_ITEMS: TrayItem[] = [];

/** Photos and PDFs going with the message, where the thread takes them (see useChatAttachments). */
export interface ComposerAttachments {
  tray: TrayItem[];
  /**
   * Whether more can be added (the thread's canAttach). Without it the tray is still shown, to be emptied, but there's no
   * paperclip: photos and files stopped being allowed here while some were waiting.
   */
  canAdd: boolean;
  /** Each picks, prepares and adds; resolves to what to say about any turned away, or null. */
  onAddPhotos: () => Promise<string | null>;
  onAddFiles: () => Promise<string | null>;
  /** Takes one out, giving the tile whose remove button takes focus next, or null for the attach button. */
  onRemove: (key: string) => string | null;
  onRetry: (key: string) => void;
}

/**
 * The message box. Its text is the draft for `draftKey`, held in memory only, so it survives leaving the thread, a failed
 * send and a failed refetch, and goes with sign-out. Return makes a new line, as on any touch keyboard, so it never sends in
 * the middle of an IME composition. The caller decides when a send clears it. Above it, `notice` (a warning, read out as it
 * appears) takes the place of `intro` (what sending here does, such as asking again) while it shows. With `attach`, a
 * paperclip (while `canAdd`) offers photos and a PDF, which wait in a tray above the box while they upload, and Send
 * waits for them; without it, `attachCaption` says under the box why they can't be added here.
 */
export function ChatComposer({
  draftKey,
  onSend,
  sending = false,
  notice,
  intro,
  attach = null,
  attachCaption = null,
}: {
  draftKey: string;
  /** The words to send, trimmed; empty when only photos and files go. */
  onSend: (text: string) => void;
  sending?: boolean;
  notice?: string | null;
  intro?: string | null;
  attach?: ComposerAttachments | null;
  /** Why photos and files can't be added here (threadFooter's attachCaption), shown in place of the paperclip. */
  attachCaption?: string | null;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();
  const draft = useChatStore((s) => s.drafts[draftKey] ?? "");
  const setDraft = useChatStore((s) => s.setDraft);
  // A phone's multiline box grows by itself up to maxHeight. A browser's doesn't, so the web export sizes it from its content.
  const [webHeight, setWebHeight] = useState(MIN_HEIGHT);
  const [attachNotice, setAttachNotice] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const attachButton = useRef<Focusable>(null);
  const box = useRef<TextInputInstance>(null);
  const removeButtons = useRef(new Map<string, Focusable>());
  // Where focus goes once a removed tile has gone: the next tile's remove button, or the paperclip (null).
  const focusAfterRemove = useRef<string | null | undefined>(undefined);
  const statusId = useId();
  const tray = attach?.tray ?? NO_ITEMS;
  const status = trayStatusText(tray);
  const sendable = traySendable(tray, draft);
  // The tray holding Send back says why; nothing to send at all is a plain disabled button.
  const held = !!sendable.reason;
  const canSend = sendable.ok && !sending;
  const full = trayFull(tray);
  const canAdd = !!attach?.canAdd;
  const warning = attachNotice ?? notice ?? null;

  useEffect(() => {
    const next = focusAfterRemove.current;
    if (next === undefined) return;
    focusAfterRemove.current = undefined;
    // With no paperclip (photos and files stopped being allowed here), the box.
    focusOn(next === null ? (attachButton.current ?? (box.current as unknown as Focusable | null)) : removeButtons.current.get(next));
  }, [tray]);
  // Android reads the polite line by itself; iOS has to be told.
  useEffect(() => {
    if (status && Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(status);
  }, [status]);

  const send = () => {
    if (!canSend) return;
    setAttachNotice(null);
    onSend(draft.trim());
    setWebHeight(MIN_HEIGHT);
  };
  const openAttach = () => {
    if (!attach?.canAdd || preparing) return;
    if (full) return setAttachNotice(CHAT_ATTACHMENT_LIMIT_TEXT);
    setAttachNotice(null);
    setChoosing(true);
  };
  const add = (choice: AttachChoice) => {
    if (!attach?.canAdd) return;
    setPreparing(true);
    void (choice === "photos" ? attach.onAddPhotos() : attach.onAddFiles())
      .then(
        (refused) => setAttachNotice(refused),
        () => setAttachNotice(CHAT_ATTACH_FAILED_TEXT),
      )
      .finally(() => setPreparing(false));
  };
  const remove = (key: string) => {
    if (!attach) return;
    setAttachNotice(null);
    focusAfterRemove.current = attach.onRemove(key);
  };
  const showCount = draft.length >= SHOW_COUNT_FROM;

  return (
    // The safe area at the bottom of a phone is behind the keyboard while it's up, so it would only leave a gap.
    <View style={{ borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.card, paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: keyboardVisible ? spacing.sm : Math.max(insets.bottom, spacing.sm) }}>
      {/* Mounted while empty, so a warning that appears in it is read out. */}
      <View style={warning ? { marginBottom: spacing.sm } : null}>
        <StatusLine tone="warning" flush persistent text={warning} icon={(color) => <IconAlert size={16} color={color} />} />
      </View>
      {!warning && intro ? (
        <View style={{ marginBottom: spacing.sm }}>
          <Notice tone="info" text={intro} />
        </View>
      ) : null}
      {attach && tray.length > 0 ? (
        <AttachmentTray
          tray={tray}
          onRemove={remove}
          onRetry={attach.onRetry}
          removeRef={(key, node) => {
            if (node) removeButtons.current.set(key, node);
            else removeButtons.current.delete(key);
          }}
        />
      ) : null}
      {/* Mounted while photos and files can be added, so what's uploading or failed is read out politely. */}
      {attach ? (
        <View role="status" accessibilityLiveRegion="polite" nativeID={statusId}>
          {status ? <Text style={{ fontSize: 12, color: colors.secondary, paddingBottom: spacing.sm }}>{status}</Text> : null}
        </View>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: spacing.sm }}>
        {canAdd ? (
          <Pressable
            ref={attachButton}
            onPress={openAttach}
            accessibilityRole="button"
            accessibilityLabel={CHAT_ATTACH_LABEL}
            // Full, it stays focusable and says why when pressed.
            aria-disabled={full || preparing}
            {...heldState(full || preparing)}
            aria-busy={preparing}
            style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? colors.bg : "transparent", opacity: full ? 0.5 : 1 })}
          >
            {preparing ? <ActivityIndicator color={colors.secondary} /> : <IconPaperclip size={22} color={colors.secondary} />}
          </Pressable>
        ) : null}
        <TextInput
          ref={box}
          accessibilityLabel="Write a message"
          placeholder="Write a message"
          placeholderTextColor={colors.faint}
          multiline
          // Off: on the web build the browser would otherwise keep the draft for session restore, on disk, past sign-out.
          autoComplete="off"
          value={draft}
          maxLength={CHAT_MESSAGE_MAX_LENGTH}
          onChangeText={(text) => {
            setAttachNotice(null);
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
          // Held back by the tray, it stays focusable and says why (the hint on a phone, the status line in the browser build).
          disabled={!held && !canSend}
          accessibilityRole="button"
          accessibilityLabel="Send message"
          accessibilityHint={sendable.reason ?? undefined}
          {...(held ? describedBy(statusId) : {})}
          aria-disabled={!canSend}
          {...heldState(held)}
          aria-busy={sending}
          style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: theme.primary, opacity: !canSend ? 0.4 : pressed ? 0.8 : 1 })}
        >
          {sending ? <ActivityIndicator color={theme.onPrimary} /> : <IconSend size={20} color={theme.onPrimary} />}
        </Pressable>
      </View>
      {attachCaption || showCount ? (
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: spacing.sm, paddingTop: spacing.xs }}>
          <Text style={{ flex: 1, fontSize: 12, color: colors.muted }}>{attachCaption ?? ""}</Text>
          {showCount ? (
            <Text style={{ fontSize: 11, fontVariant: ["tabular-nums"], color: draft.length >= CHAT_MESSAGE_MAX_LENGTH ? colors.danger : colors.muted, fontWeight: draft.length >= CHAT_MESSAGE_MAX_LENGTH ? "600" : "400" }}>
              {draft.length.toLocaleString()} / {CHAT_MESSAGE_MAX_LENGTH.toLocaleString()}
            </Text>
          ) : null}
        </View>
      ) : null}
      {canAdd ? <AttachSheet open={choosing} onClose={() => setChoosing(false)} onChoose={add} /> : null}
    </View>
  );
}
