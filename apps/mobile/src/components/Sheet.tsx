import { STATUS_TONES } from "@illuminize/shared";
import { useEffect, type ReactNode } from "react";
import { AccessibilityInfo, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, spacing } from "@/theme";

/** A panel that slides up from the bottom, for choices and short forms. Closes from its backdrop and the system back. */
export function Sheet({ open, title, onClose, onDismiss, children }: { open: boolean; title: string; onClose: () => void; onDismiss?: () => void; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose} onDismiss={onDismiss}>
      <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={0} style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(15,23,42,0.5)" }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        <View role="dialog" aria-modal aria-label={title} style={{ backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "85%" }}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing.xl + insets.bottom, gap: spacing.md }}>
            <Text role="heading" style={{ fontSize: 18, fontWeight: "700", color: colors.text }}>
              {title}
            </Text>
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/**
 * A line about what just happened, read out by screen readers, in the shared info or warning tone (STATUS_TONES). Mobile
 * has no toasts. `icon` draws before the text in the tone's ink (an SVG from components/icons), as Badge's does.
 * `persistent` keeps the live region mounted, taking no room, while there's nothing to say: screen readers that follow a
 * live region's changes but can miss a new one arriving (the web build's) then read what goes in later. Only where the
 * parent has no `gap`, which an empty child still takes.
 */
export function StatusLine({
  text,
  tone = "info",
  flush = false,
  icon,
  persistent = false,
}: {
  text: string | null;
  tone?: "info" | "warning";
  /** Inside a card, with no margin of its own. */
  flush?: boolean;
  icon?: (color: string) => ReactNode;
  persistent?: boolean;
}) {
  // Android reads a live region by itself; iOS has to be told.
  useEffect(() => {
    if (text && Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(text);
  }, [text]);
  if (!text && !persistent) return null;
  const look = STATUS_TONES[tone];
  return (
    <View
      role="status"
      accessibilityLiveRegion="polite"
      style={
        text
          ? { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, marginHorizontal: flush ? 0 : spacing.md, marginBottom: flush ? 0 : spacing.sm, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: look.fill }
          : null
      }
    >
      {text && icon ? (
        <View aria-hidden style={{ paddingTop: 1 }}>
          {icon(look.ink)}
        </View>
      ) : null}
      {text ? <Text style={{ flexShrink: 1, fontSize: 13, color: look.ink }}>{text}</Text> : null}
    </View>
  );
}
