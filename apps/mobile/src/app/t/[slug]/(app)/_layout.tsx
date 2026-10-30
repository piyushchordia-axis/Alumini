import { useQuery } from "@tanstack/react-query";
import { Redirect, Tabs, useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { Avatar, ErrorText, Spinner } from "@/components/ui";
import { MembershipContext, useMembershipQuery } from "@/hooks/useMembership";
import { usePushRegistration } from "@/hooks/usePushRegistration";
import { useTenant } from "@/hooks/useTenant";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { useAuthStore } from "@/stores/authStore";
import { colors, useTheme } from "@/theme";

const ICONS: Record<string, string> = { feed: "💬", jobs: "💼", funding: "🚀", events: "📅", directory: "🎓" };

/** Membership guard + the five-tab member shell. */
export default function AppTabsLayout() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const theme = useTheme();
  const authed = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const tenant = useTenant(slug);
  const membership = useMembershipQuery(slug);
  const unread = useQuery({ queryKey: qk.unread(slug ?? ""), queryFn: () => api.notifications.unreadCount(slug!), enabled: !!membership.data && membership.data.status === "APPROVED", refetchInterval: 60_000 });
  usePushRegistration(authed);

  if (!authed) return <Redirect href={`/t/${slug}/login`} />;
  if (tenant.isLoading || membership.isLoading) return <Spinner />;
  if (!tenant.data) return <ErrorText error={tenant.error ?? "Institution not found"} />;
  if (membership.error || !membership.data) return <Redirect href={`/t/${slug}/register`} />;
  if (membership.data.status !== "APPROVED") return <Redirect href={`/t/${slug}/pending`} />;

  const f = tenant.data.settings.features;
  const isTenantAdmin = membership.data.role === "TENANT_ADMIN" || !!user?.isPlatformAdmin;
  return (
    <MembershipContext.Provider value={{ tenant: tenant.data, membership: membership.data, isTenantAdmin }}>
      <Tabs
        screenOptions={({ route }) => ({
          headerShown: true,
          headerTitle: tenant.data!.shortName ?? tenant.data!.name,
          headerTitleStyle: { fontWeight: "700" },
          headerLeft: () => (
            <View style={{ marginLeft: 12 }}>
              <Avatar name={tenant.data!.shortName ?? tenant.data!.name} src={tenant.data!.logoUrl} size={30} />
            </View>
          ),
          headerRight: () => (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 14, marginRight: 12 }}>
              <Pressable onPress={() => router.push(`/t/${slug}/profile/notifications`)} hitSlop={8}>
                <Text style={{ fontSize: 20 }}>🔔</Text>
                {!!unread.data?.count && (
                  <View style={{ position: "absolute", top: -4, right: -6, backgroundColor: colors.danger, borderRadius: 8, paddingHorizontal: 4, minWidth: 16, alignItems: "center" }}>
                    <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>{unread.data.count > 99 ? "99+" : unread.data.count}</Text>
                  </View>
                )}
              </Pressable>
              <Pressable onPress={() => router.push(`/t/${slug}/profile`)} hitSlop={8}>
                <Avatar name={membership.data!.fullName} src={membership.data!.avatarUrl} size={30} />
              </Pressable>
            </View>
          ),
          tabBarActiveTintColor: theme.primary,
          tabBarInactiveTintColor: colors.muted,
          tabBarIcon: ({ focused }) => <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.6 }}>{ICONS[route.name.split("/")[0] ?? ""] ?? "•"}</Text>,
          tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        })}
      >
        <Tabs.Screen name="feed" options={{ title: "Feed", href: f.feed ? undefined : null }} />
        <Tabs.Screen name="jobs" options={{ title: "Jobs", href: f.jobs ? undefined : null }} />
        <Tabs.Screen name="funding" options={{ title: "Funding", href: f.funding ? undefined : null }} />
        <Tabs.Screen name="events" options={{ title: "Events", href: f.events ? undefined : null }} />
        <Tabs.Screen name="directory" options={{ title: "Directory", href: f.directory ? undefined : null }} />
        <Tabs.Screen name="profile" options={{ href: null, headerShown: false }} />
      </Tabs>
    </MembershipContext.Provider>
  );
}
