import { useRouter, type Href } from "expo-router";
import type { ReactNode } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMembership } from "@/hooks/useMembership";
import { homeHref } from "@/lib/sections";
import { colors, radius, spacing } from "@/theme";

const iconButton = { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" } as const;

/**
 * In-tree stack title bar (back + title). Owns the status-bar inset so pushed screens like profile and notifications
 * do not draw under a floating native header. `badge` is a pill after the title, such as the admin console's "Admin".
 * `fallbackHref` is where Back goes when there's nothing to go back to (a reload, a link opened cold): the member home
 * unless given.
 */
export function StackHeader({ title, actions, badge, fallbackHref }: { title: string; actions?: ReactNode; badge?: string; fallbackHref?: Href }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tenant } = useMembership();
  const leave = () => (router.canGoBack() ? router.back() : router.replace(fallbackHref ?? homeHref(tenant.slug, tenant.settings.features)));
  return (
    <View style={{ paddingTop: insets.top, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <View style={{ flexDirection: "row", alignItems: "center", minHeight: 56, paddingHorizontal: spacing.xs, gap: spacing.xs }}>
        <Pressable onPress={leave} accessibilityRole="button" accessibilityLabel="Back" style={({ pressed }) => [iconButton, pressed ? { backgroundColor: colors.bg } : null]}>
          <Text accessible={false} style={Platform.OS === "ios" ? { fontSize: 32, lineHeight: 34, color: colors.text } : { fontSize: 22, color: colors.text }}>
            {Platform.OS === "ios" ? "‹" : "←"}
          </Text>
        </Pressable>
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.xs }}>
          <Text role="heading" numberOfLines={1} style={{ flexShrink: 1, fontSize: 17, fontWeight: "700", color: colors.text }}>
            {title}
          </Text>
          {badge != null && (
            // Slate, as on the web console's bar, so it reads as the console and not the institution's brand.
            <View style={{ backgroundColor: "#0f172a", borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 2 }}>
              <Text style={{ color: "#fff", fontSize: 12, fontWeight: "600" }}>{badge}</Text>
            </View>
          )}
        </View>
        {actions}
      </View>
    </View>
  );
}
