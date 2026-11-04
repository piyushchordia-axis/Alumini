import { isApiClientError } from "@illuminize/shared/client";
import { Redirect, useGlobalSearchParams, useRouter } from "expo-router";
import { Image, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { IconBusinesses, IconDirectory, IconEvents, IconFeed, IconFunding, IconJobs } from "@/components/icons";
import { Avatar, Button, Spinner } from "@/components/ui";
import { useMembershipQuery } from "@/hooks/useMembership";
import { useTenant } from "@/hooks/useTenant";
import { homeHref } from "@/lib/sections";
import { useAuthStore } from "@/stores/authStore";
import { colors, elevation, spacing, useTheme } from "@/theme";

/** Tenant landing: branding + sign-in, or a redirect into the app for signed-in users. */
export default function TenantLandingScreen() {
  // Global, because the layout's error screen unmounts the stack, and Try again brings it back on this screen with no params of its own.
  const { slug } = useGlobalSearchParams<{ slug: string }>();
  const router = useRouter();
  const theme = useTheme();
  const tenant = useTenant(slug);
  const hydrated = useAuthStore((s) => s.hydrated);
  const authed = useAuthStore((s) => s.isAuthenticated);
  const membership = useMembershipQuery(authed ? slug : undefined);

  if (!tenant.data || !hydrated) return <Spinner />;
  if (authed) {
    if (membership.isLoading) return <Spinner label="Checking your membership…" />;
    if (membership.data) return <Redirect href={membership.data.status === "APPROVED" ? homeHref(slug!, tenant.data.settings.features) : `/t/${slug}/pending`} />;
    if (membership.error && isApiClientError(membership.error) && membership.error.status === 404) return <Redirect href={`/t/${slug}/register`} />;
  }
  const t = tenant.data;
  const f = t.settings.features;
  const features = [
    f.feed && { Icon: IconFeed, label: "Feed" },
    f.jobs && { Icon: IconJobs, label: "Jobs" },
    f.funding && { Icon: IconFunding, label: "Funding" },
    f.events && { Icon: IconEvents, label: "Events" },
    f.businesses && { Icon: IconBusinesses, label: "Businesses" },
    f.directory && { Icon: IconDirectory, label: "Directory" },
  ].filter(Boolean) as { Icon: typeof IconFeed; label: string }[];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={["bottom", "left", "right"]}>
      <View style={{ height: 280, backgroundColor: theme.primary }}>
        {t.coverImageUrl ? <Image source={{ uri: t.coverImageUrl }} style={{ width: "100%", height: "100%" }} /> : null}
        <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, top: 0, backgroundColor: "rgba(0,0,0,0.28)" }} />
        <View style={{ position: "absolute", left: spacing.lg, right: spacing.lg, bottom: 88, flexDirection: "row", alignItems: "flex-end", gap: 12 }}>
          <Avatar name={t.shortName ?? t.name} src={t.logoUrl} size={56} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 26, fontWeight: "800", color: "#fff" }}>{t.shortName ?? t.name}</Text>
            <Text style={{ marginTop: 4, fontSize: 14, color: "rgba(255,255,255,0.9)" }}>{t.tagline ?? `${t.shortName ?? t.name} alumni network`}</Text>
          </View>
        </View>
      </View>
      <View style={{ marginHorizontal: spacing.lg, marginTop: -56, backgroundColor: "#fff", borderRadius: 20, padding: spacing.xl, gap: spacing.md, ...elevation[2] }}>
        {t.welcomeMessage ? <Text style={{ color: "#475569", lineHeight: 20 }}>{t.welcomeMessage}</Text> : null}
        <Button title="Sign in / Join with mobile number" onPress={() => router.push(`/t/${slug}/login`)} />
        <Text style={{ fontSize: 12, color: colors.muted, textAlign: "center" }}>
          {t.settings.memberApprovalMode === "ADMIN_APPROVAL" ? "New members are verified by the alumni office." : "New members get instant access."}
        </Text>
        {features.length > 0 && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md }}>
            {features.map((item) => (
              <View key={item.label} style={{ width: "46%", flexDirection: "row", alignItems: "center", gap: 8 }}>
                <item.Icon size={16} color={theme.primary} />
                <Text style={{ color: colors.muted, fontSize: 13 }}>{item.label}</Text>
              </View>
            ))}
          </View>
        )}
        <Pressable onPress={() => router.replace("/")} accessibilityRole="button" hitSlop={8}>
          <Text style={{ textAlign: "center", color: colors.faint, fontSize: 12 }}>Choose a different institution</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
