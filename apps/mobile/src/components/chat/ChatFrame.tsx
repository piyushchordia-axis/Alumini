import type { ChatMemberDto } from "@illuminize/shared";
import { useRouter } from "expo-router";
import { useEffect, type ReactNode } from "react";
import { AccessibilityInfo, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar, Button } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { homeHref } from "@/lib/sections";
import { colors, radius, spacing } from "@/theme";

/**
 * Back to whatever opened this. With nothing behind it, which the (app) anchor should rule out, the home section: a chat
 * screen may be what the member can't use.
 */
export function useLeaveChatScreen() {
  const router = useRouter();
  const { tenant } = useMembership();
  return () => (router.canGoBack() ? router.back() : router.replace(homeHref(tenant.slug, tenant.settings.features)));
}

/**
 * A chat screen above the tabs, with no tab bar and no native header. Its root sits at the top of the window, so the
 * keyboard's overlap is measured from there with no offset: the keyboard then pushes up the composer on iOS, and on Android
 * whether or not the window resizes for it.
 */
export function ChatScreen({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={0} style={{ flex: 1, backgroundColor: colors.bg, paddingLeft: insets.left, paddingRight: insets.right }}>
      {children}
    </KeyboardAvoidingView>
  );
}

/** A chat screen's title bar: back, who it's with, and the screen's own actions. No `member` means no avatar, as while loading. */
export function ChatHeader({ title, member, subtitle, actions }: { title: string; member?: ChatMemberDto | null; subtitle?: string; actions?: ReactNode }) {
  const insets = useSafeAreaInsets();
  const leave = useLeaveChatScreen();
  return (
    <View style={{ paddingTop: insets.top, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <View style={{ flexDirection: "row", alignItems: "center", minHeight: 56, paddingHorizontal: spacing.xs, gap: spacing.xs }}>
        <Pressable onPress={leave} accessibilityRole="button" accessibilityLabel="Back" style={({ pressed }) => [iconButton, pressed ? { backgroundColor: colors.bg } : null]}>
          {/* What the native headers on the other screens show. */}
          <Text accessible={false} style={Platform.OS === "ios" ? { fontSize: 32, lineHeight: 34, color: colors.text } : { fontSize: 22, color: colors.text }}>
            {Platform.OS === "ios" ? "‹" : "←"}
          </Text>
        </Pressable>
        {member !== undefined && <Avatar name={title} src={member?.avatarUrl} size={36} />}
        <View style={{ flex: 1, minWidth: 0, paddingHorizontal: spacing.xs }}>
          <Text role="heading" numberOfLines={1} style={{ fontSize: 16, fontWeight: "700", color: colors.text }}>
            {title}
          </Text>
          {subtitle ? (
            <Text numberOfLines={1} style={{ fontSize: 12, color: colors.muted }}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {actions}
      </View>
    </View>
  );
}

/** Round, 44 points, for an icon in a title bar. */
export const iconButton = { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" } as const;

/** In place of a chat screen that can't be shown: says why and offers a way on. It never leaves the member on a blank screen. */
export function ChatNotice({ icon = "💬", title, text, children }: { icon?: string; title: string; text?: string; children?: ReactNode }) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.sm }}>
      <Text style={{ fontSize: 32 }} accessible={false}>
        {icon}
      </Text>
      <Text style={{ fontSize: 16, fontWeight: "700", color: colors.text, textAlign: "center" }}>{title}</Text>
      {text ? <Text style={{ fontSize: 14, color: colors.muted, textAlign: "center", maxWidth: 320 }}>{text}</Text> : null}
      {children ? <View style={{ marginTop: spacing.md, gap: spacing.sm, width: "100%", maxWidth: 320 }}>{children}</View> : null}
    </View>
  );
}

/**
 * Messages are off for this institution, or this member is a current pupil. The screens above the tabs check this
 * themselves, because the inbox tab's gate doesn't cover them, and make no chat calls when it's shown.
 */
export function ChatOff() {
  const { tenant } = useMembership();
  const leave = useLeaveChatScreen();
  return (
    <ChatScreen>
      <ChatHeader title="Messages" />
      <ChatNotice icon="🔒" title="Messages aren't available" text={`Private messages aren't open to your account at ${tenant.shortName ?? tenant.name}.`}>
        <Button title="Go back" onPress={leave} />
      </ChatNotice>
    </ChatScreen>
  );
}

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
export function StatusLine({ text, tone = "info" }: { text: string | null; tone?: "info" | "warning" }) {
  // Android reads a live region by itself; iOS has to be told.
  useEffect(() => {
    if (text && Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(text);
  }, [text]);
  if (!text) return null;
  return (
    <View role="status" accessibilityLiveRegion="polite" style={{ marginHorizontal: spacing.md, marginBottom: spacing.sm, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: tone === "warning" ? "#fef3c7" : "#e0f2fe" }}>
      <Text style={{ fontSize: 13, color: tone === "warning" ? "#92400e" : "#075985" }}>{text}</Text>
    </View>
  );
}
