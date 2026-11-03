import type { TenantFeature } from "@illuminize/shared";
import { useQuery } from "@tanstack/react-query";
import { Redirect, useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { Avatar } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { usePollInterval } from "@/lib/realtime";
import { homeHref } from "@/lib/sections";
import { colors } from "@/theme";

/**
 * Header for the first screen of each tab: institution name and logo, notifications bell and the member's avatar.
 * Deeper screens use their stack's normal header with a back button, so there is only ever one header.
 */
export function useAppHeaderOptions() {
  const { tenant, membership } = useMembership();
  const router = useRouter();
  const slug = tenant.slug;
  const pollInterval = usePollInterval();
  const unread = useQuery({ queryKey: qk.unread(slug), queryFn: () => api.notifications.unreadCount(slug), refetchInterval: pollInterval });
  const count = unread.data?.count ?? 0;
  return {
    headerShown: true,
    headerTitle: tenant.shortName ?? tenant.name,
    headerTitleStyle: { fontWeight: "700" as const },
    headerLeft: () => (
      <View style={{ marginRight: 10 }} accessible={false}>
        <Avatar name={tenant.shortName ?? tenant.name} src={tenant.logoUrl} size={30} />
      </View>
    ),
    headerRight: () => (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        <Pressable onPress={() => router.push(`/t/${slug}/profile/notifications`, { withAnchor: true })} hitSlop={8} accessibilityRole="button" accessibilityLabel={count ? `Notifications, ${count} unread` : "Notifications"}>
          <Text style={{ fontSize: 20 }}>🔔</Text>
          {!!count && (
            <View style={{ position: "absolute", top: -4, right: -6, backgroundColor: colors.danger, borderRadius: 8, paddingHorizontal: 4, minWidth: 16, alignItems: "center" }}>
              <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>{count > 99 ? "99+" : count}</Text>
            </View>
          )}
        </Pressable>
        <Pressable onPress={() => router.push(`/t/${slug}/profile`)} hitSlop={8} accessibilityRole="button" accessibilityLabel="My profile">
          <Avatar name={membership.fullName} src={membership.avatarUrl} size={30} />
        </Pressable>
      </View>
    ),
  };
}

/** Wraps a tab's stack: if the institution has switched the section off, go to the first enabled one instead. */
export function FeatureGate({ feature, children }: { feature: TenantFeature; children: ReactNode }) {
  const { tenant } = useMembership();
  if (!tenant.settings.features[feature]) return <Redirect href={homeHref(tenant.slug, tenant.settings.features)} />;
  return <>{children}</>;
}

/** The same for Messages, which also needs a member who isn't a current pupil. */
export function ChatGate({ children }: { children: ReactNode }) {
  const { tenant, membership } = useMembership();
  if (!tenant.settings.features.messaging || !membership.chatEligible) return <Redirect href={homeHref(tenant.slug, tenant.settings.features)} />;
  return <>{children}</>;
}

/** Shared options for pushed detail screens and modals. */
export const detailHeader = { headerShown: true, headerTitleStyle: { fontWeight: "700" as const }, headerBackTitle: "Back" };
