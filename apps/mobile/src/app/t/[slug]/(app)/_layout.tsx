import { isApiClientError } from "@illuminize/shared/client";
import { Redirect, Tabs, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { Text } from "react-native";
import { LoadError, Spinner } from "@/components/ui";
import { MembershipContext, useMembershipQuery } from "@/hooks/useMembership";
import { usePushRegistration } from "@/hooks/usePushRegistration";
import { useTenant } from "@/hooks/useTenant";
import { useAuthStore } from "@/stores/authStore";
import { useTenantStore } from "@/stores/tenantStore";
import { colors, useTheme } from "@/theme";

const ICONS: Record<string, string> = { feed: "💬", jobs: "💼", funding: "🚀", events: "📅", directory: "🎓" };

/** Membership guard + the five-tab member shell. Each tab's stack draws its own header (see AppHeader). */
export default function AppTabsLayout() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const theme = useTheme();
  const hydrated = useAuthStore((s) => s.hydrated);
  const authed = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const setLast = useTenantStore((s) => s.setLastTenantSlug);
  const tenant = useTenant(slug);
  const membership = useMembershipQuery(slug);
  const approved = membership.data?.status === "APPROVED";
  usePushRegistration(authed && approved);

  // Remember only institutions the member can open, so the start screen never bounces into a waiting screen.
  useEffect(() => {
    if (approved && slug) setLast(slug);
  }, [approved, slug, setLast]);

  if (!hydrated) return <Spinner />;
  if (!authed) return <Redirect href={`/t/${slug}/login`} />;
  if (tenant.isLoading || membership.isLoading) return <Spinner />;
  if (!tenant.data) return <LoadError error={tenant.error ?? "Institution not found"} onRetry={() => void tenant.refetch()} onBack={() => router.replace("/")} />;
  if (membership.error) {
    const notMember = isApiClientError(membership.error) && (membership.error.status === 404 || membership.error.code === "NOT_A_MEMBER");
    if (notMember) return <Redirect href={`/t/${slug}/register`} />;
    return <LoadError error={membership.error} onRetry={() => void membership.refetch()} onBack={() => router.replace("/")} />;
  }
  if (!membership.data) return <Spinner />;
  if (!approved) return <Redirect href={`/t/${slug}/pending`} />;

  const f = tenant.data.settings.features;
  const isTenantAdmin = membership.data.role === "TENANT_ADMIN" || !!user?.isPlatformAdmin;
  return (
    <MembershipContext.Provider value={{ tenant: tenant.data, membership: membership.data, isTenantAdmin }}>
      <Tabs
        screenOptions={({ route }) => ({
          headerShown: false,
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
        <Tabs.Screen name="profile" options={{ href: null }} />
      </Tabs>
    </MembershipContext.Provider>
  );
}
