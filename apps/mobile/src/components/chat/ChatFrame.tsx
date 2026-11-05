import type { ChatMemberDto } from "@illuminize/shared";
import { useRouter } from "expo-router";
import type { ReactElement, ReactNode } from "react";
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { IconLock } from "@/components/icons";
import { Avatar, Button } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { homeHref } from "@/lib/sections";
import { colors, PlainPage, spacing, useTheme } from "@/theme";

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
    // Chats stay on the plain page whatever background the member chose, and so does everything in them that reads it.
    <PlainPage>
      <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={0} style={{ flex: 1, backgroundColor: colors.bg, paddingLeft: insets.left, paddingRight: insets.right }}>
        {children}
      </KeyboardAvoidingView>
    </PlainPage>
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

/**
 * In place of a chat screen that can't be shown: says why and offers a way on. It never leaves the member on a blank screen.
 * `icon` is an SVG from `components/icons.tsx`, such as `<IconLock size={32} color={colors.faint} />`; screen readers skip it.
 */
export function ChatNotice({ icon, title, text, children }: { icon?: ReactElement; title: string; text?: string; children?: ReactNode }) {
  // On the page it sits on: a job that can't be shown is on the member's background, a chat on the plain page.
  const { pageMuted } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.sm }}>
      {icon ? <View aria-hidden>{icon}</View> : null}
      <Text style={{ fontSize: 16, fontWeight: "700", color: colors.text, textAlign: "center" }}>{title}</Text>
      {text ? <Text style={{ fontSize: 14, color: pageMuted, textAlign: "center", maxWidth: 320 }}>{text}</Text> : null}
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
      <ChatNotice icon={<IconLock size={32} color={colors.faint} />} title="Messages aren't available" text={`Private messages aren't open to your account at ${tenant.shortName ?? tenant.name}.`}>
        <Button title="Go back" onPress={leave} />
      </ChatNotice>
    </ChatScreen>
  );
}

// They began here, and chat screens still import them from here.
export { Sheet, StatusLine } from "@/components/Sheet";
