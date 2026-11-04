import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { IconBell } from "@/components/icons";
import { Avatar } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { usePollInterval } from "@/lib/realtime";
import { colors, spacing } from "@/theme";

/**
 * In-tree header for tab roots: institution logo and name, notifications, member avatar.
 * Owns the status-bar inset so content never draws under it (native stack headers overlay the scene on device).
 */
export function MemberAppBar() {
  const { tenant, membership } = useMembership();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const slug = tenant.slug;
  const title = tenant.shortName ?? tenant.name;
  const pollInterval = usePollInterval();
  const unread = useQuery({ queryKey: qk.unread(slug), queryFn: () => api.notifications.unreadCount(slug), refetchInterval: pollInterval });
  const count = unread.data?.count ?? 0;
  return (
    <View style={{ paddingTop: insets.top, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <View style={{ flexDirection: "row", alignItems: "center", minHeight: 56, paddingHorizontal: spacing.md, gap: spacing.sm }}>
        <Avatar name={title} src={tenant.logoUrl} size={30} />
        <Text role="heading" numberOfLines={1} style={{ flex: 1, fontSize: 17, fontWeight: "700", color: colors.text }}>
          {title}
        </Text>
        <Pressable onPress={() => router.push(`/t/${slug}/profile/notifications`, { withAnchor: true })} hitSlop={8} accessibilityRole="button" accessibilityLabel={count ? `Notifications, ${count} unread` : "Notifications"} style={{ padding: 4 }}>
          <IconBell size={22} color={colors.text} />
          {!!count && (
            <View style={{ position: "absolute", top: 0, right: 0, backgroundColor: colors.danger, borderRadius: 8, paddingHorizontal: 4, minWidth: 16, alignItems: "center" }}>
              <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>{count > 99 ? "99+" : count}</Text>
            </View>
          )}
        </Pressable>
        <Pressable onPress={() => router.push(`/t/${slug}/profile`)} hitSlop={8} accessibilityRole="button" accessibilityLabel="My profile" style={{ padding: 4 }}>
          <Avatar name={membership.fullName} src={membership.avatarUrl} size={30} />
        </Pressable>
      </View>
    </View>
  );
}
