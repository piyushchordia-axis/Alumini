import { isApiClientError } from "@illuminize/shared/client";
import { useQueryClient } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { Text, View } from "react-native";
import { Button, ErrorText, Screen, Spinner, Title } from "@/components/ui";
import { useMembershipQuery } from "@/hooks/useMembership";
import { useTenant } from "@/hooks/useTenant";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import { colors } from "@/theme";

export default function PendingScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const tenant = useTenant(slug);
  const membership = useMembershipQuery(slug);
  const clear = useAuthStore((s) => s.clear);
  useEffect(() => {
    const t = setInterval(() => void membership.refetch(), 30_000);
    return () => clearInterval(t);
  }, [membership]);
  if (tenant.isLoading || membership.isLoading || !tenant.data) return <Spinner />;
  if (membership.error) {
    if (isApiClientError(membership.error) && membership.error.status === 404) return <Redirect href={`/t/${slug}/register`} />;
    return <ErrorText error={membership.error} />;
  }
  const m = membership.data!;
  if (m.status === "APPROVED") return <Redirect href={`/t/${slug}/feed`} />;
  const copy = {
    PENDING: { title: "Awaiting approval", icon: "⏳", body: `Thanks ${m.fullName.split(" ")[0]}! The ${tenant.data.shortName ?? tenant.data.name} alumni office reviews every request. You'll be notified when it's approved.` },
    REJECTED: { title: "Request not approved", icon: "✋", body: m.statusReason ? `Reason given: ${m.statusReason}` : "Your request was not approved. You can update your details and re-apply." },
    SUSPENDED: { title: "Membership suspended", icon: "⛔", body: m.statusReason ? `Reason given: ${m.statusReason}` : "Please contact the alumni office." },
  }[m.status as "PENDING" | "REJECTED" | "SUSPENDED"];
  return (
    <Screen>
      <View style={{ alignItems: "center", gap: 12, paddingVertical: 32 }}>
        <Text style={{ fontSize: 56 }}>{copy.icon}</Text>
        <Title>{copy.title}</Title>
        <Text style={{ color: colors.muted, textAlign: "center", lineHeight: 20 }}>{copy.body}</Text>
      </View>
      {m.status === "REJECTED" && <Button title="Update details and re-apply" onPress={() => router.replace(`/t/${slug}/register`)} />}
      {m.status === "PENDING" && <Button title="Check again" variant="outline" onPress={() => void membership.refetch()} loading={membership.isFetching} />}
      <Button
        title="Sign out"
        variant="ghost"
        onPress={async () => {
          await api.auth.logout();
          clear();
          qc.clear();
          router.replace(`/t/${slug}`);
        }}
      />
    </Screen>
  );
}
