import { isApiClientError } from "@illuminize/shared/client";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { Image, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Avatar, Button, Spinner } from "@/components/ui";
import { useMembershipQuery } from "@/hooks/useMembership";
import { useTenant } from "@/hooks/useTenant";
import { useAuthStore } from "@/stores/authStore";
import { colors, spacing, useTheme } from "@/theme";

/** Tenant landing: branding + sign-in, or a redirect into the app for signed-in users. */
export default function TenantLandingScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const theme = useTheme();
  const tenant = useTenant(slug);
  const authed = useAuthStore((s) => s.isAuthenticated);
  const membership = useMembershipQuery(authed ? slug : undefined);

  if (!tenant.data) return <Spinner />;
  if (authed) {
    if (membership.isLoading) return <Spinner label="Checking your membership…" />;
    if (membership.data) return <Redirect href={membership.data.status === "APPROVED" ? `/t/${slug}/feed` : `/t/${slug}/pending`} />;
    if (membership.error && isApiClientError(membership.error) && membership.error.status === 404) return <Redirect href={`/t/${slug}/register`} />;
  }
  const t = tenant.data;
  const f = t.settings.features;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ height: 180, backgroundColor: theme.primary }}>{t.coverImageUrl && <Image source={{ uri: t.coverImageUrl }} style={{ width: "100%", height: "100%" }} />}</View>
      <View style={{ margin: spacing.lg, marginTop: -60, backgroundColor: "#fff", borderRadius: 20, padding: spacing.xl, gap: spacing.md, borderWidth: 1, borderColor: colors.border }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Avatar name={t.shortName ?? t.name} src={t.logoUrl} size={56} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 11, color: colors.muted, textTransform: "uppercase", letterSpacing: 1 }}>{t.name}</Text>
            <Text style={{ fontSize: 18, fontWeight: "700", color: colors.text }}>{t.tagline ?? `${t.shortName ?? t.name} alumni network`}</Text>
          </View>
        </View>
        {t.welcomeMessage && <Text style={{ color: "#475569", lineHeight: 20 }}>{t.welcomeMessage}</Text>}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {f.feed && <Text style={{ color: colors.muted }}>💬 Feed</Text>}
          {f.jobs && <Text style={{ color: colors.muted }}>💼 Jobs</Text>}
          {f.funding && <Text style={{ color: colors.muted }}>🚀 Funding</Text>}
          {f.events && <Text style={{ color: colors.muted }}>📅 Events</Text>}
          {f.directory && <Text style={{ color: colors.muted }}>🎓 Directory</Text>}
        </View>
        <Button title="Sign in / Join with mobile number" onPress={() => router.push(`/t/${slug}/login`)} />
        <Text style={{ fontSize: 12, color: colors.muted, textAlign: "center" }}>
          {t.settings.memberApprovalMode === "ADMIN_APPROVAL" ? "New members are verified by the alumni office." : "New members get instant access."}
        </Text>
        <Pressable onPress={() => router.replace("/")}>
          <Text style={{ textAlign: "center", color: colors.faint, fontSize: 12 }}>Choose a different institution</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
