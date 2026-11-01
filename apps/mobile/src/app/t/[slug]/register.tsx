import type { MembershipDto } from "@illuminize/shared";
import { isApiClientError } from "@illuminize/shared/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { Alert, Text, View } from "react-native";
import { ProfileForm } from "@/components/ProfileForm";
import { ErrorText, LoadError, Screen, Spinner, Title } from "@/components/ui";
import { useMembershipQuery } from "@/hooks/useMembership";
import { useProfileFields } from "@/hooks/useProfileFields";
import { useTenant } from "@/hooks/useTenant";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { homeHref } from "@/lib/sections";
import { useAuthStore } from "@/stores/authStore";

export default function RegisterScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const tenant = useTenant(slug);
  const hydrated = useAuthStore((s) => s.hydrated);
  const authed = useAuthStore((s) => s.isAuthenticated);
  const membership = useMembershipQuery(slug);
  const fields = useProfileFields(authed ? slug : undefined);
  // An invitation for my (verified) phone: prefill, and allowed in even when registration is closed.
  const invitation = useQuery({ queryKey: qk.myInvitation(slug ?? ""), queryFn: () => api.membership.invitation(slug!), enabled: authed && !!slug, staleTime: 60_000 });
  if (!hydrated) return <Spinner />;
  if (!authed) return <Redirect href={`/t/${slug}/login`} />;
  if (tenant.isLoading || membership.isLoading || fields.isLoading || invitation.isLoading || !tenant.data) return <Spinner />;
  const existing = membership.data;
  if (existing && existing.status !== "REJECTED") return <Redirect href={existing.status === "APPROVED" ? homeHref(slug!, tenant.data.settings.features) : `/t/${slug}/pending`} />;
  if (membership.error && !(isApiClientError(membership.error) && membership.error.status === 404)) return <LoadError error={membership.error} onRetry={() => void membership.refetch()} onBack={() => router.replace("/")} />;
  const t = tenant.data;
  const reapplying = existing?.status === "REJECTED";
  const inv = invitation.data ?? null;
  const prefill = inv && !existing ? ({ fullName: inv.fullName ?? undefined, batchYear: inv.batchYear ?? undefined, fields: Object.entries(inv.fields).map(([key, value]) => ({ key, value })) } as Partial<MembershipDto>) : undefined;
  return (
    <Screen topInset>
      <Title sub={reapplying ? `Previous reason: ${existing?.statusReason ?? "not given"}` : `Tell your ${t.shortName ?? t.name} batchmates who you are`}>{reapplying ? "Re-apply to join" : "Create your profile"}</Title>
      {inv && (
        <View accessibilityRole="summary" style={{ backgroundColor: "#ecfdf5", borderRadius: 10, padding: 12 }}>
          <Text style={{ color: "#065f46" }}>
            🎉 You were invited to {t.name}. {inv.autoApprove ? "You'll be in as soon as you save your profile." : "Save your profile and an admin will approve it."}
          </Text>
        </View>
      )}
      {!t.settings.allowSelfRegistration && !inv ? (
        <ErrorText error="This institution is not accepting new registrations right now. Contact your alumni office." />
      ) : (
        <ProfileForm
          tenant={t}
          initial={existing ?? prefill}
          customFields={fields.data ?? []}
          mode="register"
          submitLabel={(inv ? inv.autoApprove : t.settings.memberApprovalMode === "AUTO_APPROVE") ? "Join the network" : "Submit for approval"}
          onSubmit={async (values) => {
            const m = await api.membership.register(slug!, values);
            qc.setQueryData(qk.membership(slug!), m);
            // Refresh the membership list (profile screen, institution switcher).
            void qc.invalidateQueries({ queryKey: qk.me });
            Alert.alert(m.status === "APPROVED" ? `Welcome to ${t.name}!` : "Submitted for approval");
            router.replace(m.status === "APPROVED" ? homeHref(slug!, t.settings.features) : `/t/${slug}/pending`);
          }}
        />
      )}
    </Screen>
  );
}
