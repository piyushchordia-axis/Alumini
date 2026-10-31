import { isApiClientError } from "@illuminize/shared/client";
import { useQueryClient } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { Alert } from "react-native";
import { ProfileForm } from "@/components/ProfileForm";
import { ErrorText, LoadError, Screen, Spinner, Title } from "@/components/ui";
import { useMembershipQuery } from "@/hooks/useMembership";
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
  if (!hydrated) return <Spinner />;
  if (!authed) return <Redirect href={`/t/${slug}/login`} />;
  if (tenant.isLoading || membership.isLoading || !tenant.data) return <Spinner />;
  const existing = membership.data;
  if (existing && existing.status !== "REJECTED") return <Redirect href={existing.status === "APPROVED" ? homeHref(slug!, tenant.data.settings.features) : `/t/${slug}/pending`} />;
  if (membership.error && !(isApiClientError(membership.error) && membership.error.status === 404)) return <LoadError error={membership.error} onRetry={() => void membership.refetch()} onBack={() => router.replace("/")} />;
  const t = tenant.data;
  const reapplying = existing?.status === "REJECTED";
  return (
    <Screen topInset>
      <Title sub={reapplying ? `Previous reason: ${existing?.statusReason ?? "not given"}` : `Tell your ${t.shortName ?? t.name} batchmates who you are`}>{reapplying ? "Re-apply to join" : "Create your profile"}</Title>
      {!t.settings.allowSelfRegistration ? (
        <ErrorText error="This institution is not accepting new registrations right now. Contact your alumni office." />
      ) : (
        <ProfileForm
          tenant={t}
          initial={existing ?? undefined}
          submitLabel={t.settings.memberApprovalMode === "ADMIN_APPROVAL" ? "Submit for approval" : "Join the network"}
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
