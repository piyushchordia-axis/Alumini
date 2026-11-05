import { isApiClientError } from "@illuminize/shared/client";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { Text, View } from "react-native";
import { IconAlert, IconClock, IconLock } from "@/components/icons";
import { Button, LoadError, Screen, Spinner, Title } from "@/components/ui";
import { useMembershipQuery } from "@/hooks/useMembership";
import { useTenant } from "@/hooks/useTenant";
import { homeHref } from "@/lib/sections";
import { useSignOut } from "@/lib/session";
import { useAuthStore } from "@/stores/authStore";
import { colors, useTheme } from "@/theme";

export default function PendingScreen() {
  const { slug = "" } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const theme = useTheme();
  const hydrated = useAuthStore((s) => s.hydrated);
  const authed = useAuthStore((s) => s.isAuthenticated);
  const tenant = useTenant(slug);
  const membership = useMembershipQuery(slug);
  const signOut = useSignOut();
  const { refetch } = membership;
  // Poll while waiting so approval shows up without leaving the screen.
  useEffect(() => {
    const t = setInterval(() => void refetch(), 30_000);
    return () => clearInterval(t);
  }, [refetch]);

  if (!hydrated) return <Spinner />;
  if (!authed) return <Redirect href={`/t/${slug}/login`} />;
  if (tenant.isLoading || membership.isLoading || !tenant.data) return <Spinner />;
  if (membership.error) {
    if (isApiClientError(membership.error) && membership.error.status === 404) return <Redirect href={`/t/${slug}/register`} />;
    return <LoadError error={membership.error} onRetry={() => void refetch()} onBack={() => router.replace("/")} />;
  }
  const m = membership.data;
  if (!m) return <Spinner />;
  if (m.status === "APPROVED") return <Redirect href={homeHref(slug, tenant.data.settings.features)} />;
  const copy = {
    PENDING: { title: "Awaiting approval", Icon: IconClock, body: `Thanks ${m.fullName.split(" ")[0]}! The ${tenant.data.shortName ?? tenant.data.name} alumni office reviews every request. You'll be notified when it's approved.` },
    REJECTED: { title: "Request not approved", Icon: IconAlert, body: m.statusReason ? `Reason given: ${m.statusReason}` : "Your request was not approved. You can update your details and re-apply." },
    SUSPENDED: { title: "Membership suspended", Icon: IconLock, body: m.statusReason ? `Reason given: ${m.statusReason}` : "Please contact the alumni office." },
  }[m.status];
  return (
    <Screen topInset>
      <View style={{ alignItems: "center", gap: 12, paddingVertical: 32 }}>
        <View aria-hidden style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: theme.primarySoft, alignItems: "center", justifyContent: "center" }}>
          <copy.Icon size={36} color={theme.primary} />
        </View>
        <Title>{copy.title}</Title>
        <Text style={{ color: colors.muted, textAlign: "center", lineHeight: 20 }}>{copy.body}</Text>
      </View>
      {m.status === "REJECTED" && <Button title="Update details and re-apply" onPress={() => router.replace(`/t/${slug}/register`)} />}
      {m.status === "PENDING" && <Button title="Check again" variant="outline" onPress={() => void refetch()} loading={membership.isFetching} />}
      <Button title="Choose another institution" variant="ghost" onPress={() => router.replace("/")} />
      <Button title="Sign out" variant="ghost" onPress={() => void signOut(`/t/${slug}`)} />
    </Screen>
  );
}
