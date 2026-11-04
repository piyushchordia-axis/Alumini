import type { MembershipDto } from "@illuminize/shared";
import { fatalQueryError, isApiClientError } from "@illuminize/shared/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useRef } from "react";
import { StyleSheet, Text, View, type ScrollViewInstance } from "react-native";
import { IconSpark } from "@/components/icons";
import { RegistrationSteps } from "@/components/profile/RegistrationSteps";
import { ErrorText, LoadError, Screen, Spinner, Title } from "@/components/ui";
import { useMembershipQuery } from "@/hooks/useMembership";
import { useProfileFields } from "@/hooks/useProfileFields";
import { useTenant } from "@/hooks/useTenant";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { homeHref } from "@/lib/sections";
import { useAuthStore } from "@/stores/authStore";
import { useTenantStore } from "@/stores/tenantStore";
import { radius, spacing } from "@/theme";

/**
 * Waiting for the first answer of a query the form can do without. Once one has come, even an error, a refetch (the app
 * coming back to the front refetches the account) never brings the spinner back: a query with no data goes back to
 * loading when it refetches, which would swap the form, and everything typed in it, for the spinner and start it again.
 */
const loadingFirstTime = (q: { isLoading: boolean; isFetched: boolean }) => q.isLoading && !q.isFetched;

export default function RegisterScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const scroller = useRef<ScrollViewInstance>(null);
  const tenant = useTenant(slug);
  const hydrated = useAuthStore((s) => s.hydrated);
  const authed = useAuthStore((s) => s.isAuthenticated);
  const storedName = useAuthStore((s) => s.user?.displayName ?? null);
  const setLast = useTenantStore((s) => s.setLastTenantSlug);
  // Nothing here refetches behind the form: with no membership cached, a refetch shows the spinner and loses what they've typed.
  const membership = useMembershipQuery(slug, { refetchOnWindowFocus: false, refetchOnReconnect: false });
  const fields = useProfileFields(authed ? slug : undefined);
  // An invitation for my (verified) phone: prefill, and allowed in even when registration is closed.
  const invitation = useQuery({ queryKey: qk.myInvitation(slug ?? ""), queryFn: () => api.membership.invitation(slug!), enabled: authed && !!slug, staleTime: 60_000 });
  // Their profile at another institution, for "Use details from …". Without it the form simply doesn't offer that.
  const copy = useQuery({
    queryKey: qk.profileCopy(slug ?? ""),
    queryFn: () => api.me.profileCopy(slug),
    enabled: authed && !!slug,
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  // Fresh (the same query as the session's): a name given when joining another institution may not be stored yet.
  const me = useQuery({ queryKey: qk.me, queryFn: () => api.me.get(), enabled: hydrated && authed, staleTime: 60_000 });
  if (!hydrated) return <Spinner />;
  if (!authed) return <Redirect href={`/t/${slug}/login`} />;
  // Without the institution or the membership's answer there's no form yet (and the membership never refetches here).
  if (tenant.isLoading || membership.isLoading || [fields, invitation, copy, me].some(loadingFirstTime) || !tenant.data) return <Spinner />;
  const membershipError = fatalQueryError(membership);
  const notMember = isApiClientError(membershipError) && membershipError.status === 404;
  const existing = membership.data;
  if (existing && existing.status !== "REJECTED") return <Redirect href={existing.status === "APPROVED" ? homeHref(slug!, tenant.data.settings.features) : `/t/${slug}/pending`} />;
  if (membershipError && !notMember)
    return (
      <LoadError
        error={membershipError}
        onRetry={() => void membership.refetch()}
        onBack={() => {
          // Forget it as the start page so the picker does not bounce straight back here.
          setLast(null);
          router.replace("/");
        }}
      />
    );
  const t = tenant.data;
  const reapplying = existing?.status === "REJECTED";
  const inv = invitation.data ?? null;
  const displayName = me.data?.user.displayName ?? storedName;
  // An invitation names them; otherwise the name they gave another institution (or an earlier sign-up) starts them off.
  const prefill: Partial<MembershipDto> | undefined = existing
    ? existing
    : inv
      ? // The form reads only each answer's key and value.
        ({ fullName: inv.fullName ?? displayName ?? undefined, batchYear: inv.batchYear ?? undefined, fields: Object.entries(inv.fields).map(([key, value]) => ({ key, value })) } as Partial<MembershipDto>)
      : displayName
        ? { fullName: displayName }
        : undefined;
  // As the server decides: an invitation the institution lets straight in, or an institution that lets everyone in.
  const autoApprove = (inv?.autoApprove ?? false) || t.settings.memberApprovalMode === "AUTO_APPROVE";
  return (
    <Screen topInset scrollRef={scroller}>
      <Title sub={reapplying ? "Update your profile, then send it again" : `Tell your ${t.shortName ?? t.name} batchmates who you are`}>{reapplying ? "Re-apply to join" : "Create your profile"}</Title>
      {!t.settings.allowSelfRegistration && !inv ? (
        <ErrorText error="This institution is not accepting new registrations right now. Contact your alumni office." />
      ) : (
        <RegistrationSteps
          tenant={t}
          initial={prefill}
          customFields={fields.data ?? []}
          submitLabel={autoApprove ? "Join the network" : "Submit for approval"}
          needsApproval={!autoApprove}
          reapplying={reapplying}
          copy={copy.data ?? null}
          scrollRef={scroller}
          notice={
            reapplying ? (
              <View role="note" style={[styles.box, styles.notice]}>
                <Text style={[styles.noticeText, { fontWeight: "700" }]}>{"Your last application wasn't approved"}</Text>
                <Text style={styles.noticeText}>{existing?.statusReason ? `Reason: ${existing.statusReason}` : "No reason was given."}</Text>
              </View>
            ) : undefined
          }
          intro={
            inv ? (
              <View accessibilityRole="summary" style={[styles.box, styles.invited]}>
                <IconSpark size={18} color="#065f46" />
                <Text style={{ flex: 1, color: "#065f46", lineHeight: 20 }}>
                  You were invited to {t.name}. {autoApprove ? "You'll be in as soon as you finish your profile." : "Finish your profile and an admin will approve it."}
                </Text>
              </View>
            ) : undefined
          }
          onSubmit={async (values) => {
            const m = await api.membership.register(slug!, values);
            qc.setQueryData(qk.membership(slug!), m);
            // Refresh the membership list (profile screen, institution switcher).
            void qc.invalidateQueries({ queryKey: qk.me });
            // The feed (with its profile card) or the waiting screen says what happened.
            router.replace(m.status === "APPROVED" ? homeHref(slug!, t.settings.features) : `/t/${slug}/pending`);
          }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.md, padding: spacing.md },
  notice: { gap: 2, borderWidth: 1, borderColor: "#fde68a", backgroundColor: "#fffbeb" },
  noticeText: { color: "#78350f", fontSize: 14, lineHeight: 20 },
  invited: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, backgroundColor: "#ecfdf5" },
});
