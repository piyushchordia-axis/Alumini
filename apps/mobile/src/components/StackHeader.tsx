import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMembership } from "@/hooks/useMembership";
import { homeHref } from "@/lib/sections";
import { colors, spacing } from "@/theme";

const iconButton = { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" } as const;

/**
 * In-tree stack title bar (back + title). Owns the status-bar inset so pushed screens like profile and notifications
 * do not draw under a floating native header.
 */
export function StackHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tenant } = useMembership();
  const leave = () => (router.canGoBack() ? router.back() : router.replace(homeHref(tenant.slug, tenant.settings.features)));
  return (
    <View style={{ paddingTop: insets.top, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <View style={{ flexDirection: "row", alignItems: "center", minHeight: 56, paddingHorizontal: spacing.xs, gap: spacing.xs }}>
        <Pressable onPress={leave} accessibilityRole="button" accessibilityLabel="Back" style={({ pressed }) => [iconButton, pressed ? { backgroundColor: colors.bg } : null]}>
          <Text accessible={false} style={Platform.OS === "ios" ? { fontSize: 32, lineHeight: 34, color: colors.text } : { fontSize: 22, color: colors.text }}>
            {Platform.OS === "ios" ? "‹" : "←"}
          </Text>
        </Pressable>
        <Text role="heading" numberOfLines={1} style={{ flex: 1, fontSize: 17, fontWeight: "700", color: colors.text, paddingHorizontal: spacing.xs }}>
          {title}
        </Text>
        {actions}
      </View>
    </View>
  );
}
