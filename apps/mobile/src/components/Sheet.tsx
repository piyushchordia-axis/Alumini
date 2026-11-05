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

/** A line about what just happened, read out by screen readers. Mobile has no toasts. */
export function StatusLine({ text, tone = "info", flush = false }: { text: string | null; tone?: "info" | "warning"; /** Inside a card, with no margin of its own. */ flush?: boolean }) {
  // Android reads a live region by itself; iOS has to be told.
  useEffect(() => {
    if (text && Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(text);
  }, [text]);
  if (!text) return null;
  return (
    <View role="status" accessibilityLiveRegion="polite" style={{ marginHorizontal: flush ? 0 : spacing.md, marginBottom: flush ? 0 : spacing.sm, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: tone === "warning" ? "#fef3c7" : "#e0f2fe" }}>
      <Text style={{ fontSize: 13, color: tone === "warning" ? "#92400e" : "#075985" }}>{text}</Text>
    </View>
  );
}
