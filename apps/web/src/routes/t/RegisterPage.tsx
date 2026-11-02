import { fatalQueryError, isApiClientError } from "@illuminize/shared/client";
import type { MembershipDto } from "@illuminize/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { AuthShell } from "@/components/layout/AuthShell";
import { ProfileForm } from "@/components/profile/ProfileForm";
import { ErrorBox, Loading } from "@/components/ui";
import { useMembershipQuery } from "@/hooks/useMembership";
import { useProfileFields } from "@/hooks/useProfileFields";
import { useTenant } from "@/hooks/useTenant";
import { useTenantSlug } from "@/hooks/useTenantSlug";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { applyTenantTheme } from "@/lib/theme";
import { toast } from "@/stores/uiStore";

export function RegisterPage() {
  const slug = useTenantSlug();
  const tenant = useTenant(slug);
  // Nothing here refetches behind the form: with no membership cached, a refetch shows the spinner and loses what they've typed.
  const membership = useMembershipQuery(slug, { refetchOnWindowFocus: false, refetchOnReconnect: false });
  const fields = useProfileFields(slug);
  // An invitation for my (verified) phone: prefill, and allowed in even when registration is closed.
  const invitation = useQuery({ queryKey: qk.myInvitation(slug), queryFn: () => api.membership.invitation(slug), staleTime: 60_000 });
  const navigate = useNavigate();
  const qc = useQueryClient();
  useEffect(() => {
    if (tenant.data) applyTenantTheme(tenant.data);
  }, [tenant.data]);

  if (tenant.isLoading || membership.isLoading || fields.isLoading || invitation.isLoading) return <Loading />;
  const tenantError = fatalQueryError(tenant);
  if (tenantError || !tenant.data) return <ErrorBox error={tenantError ?? "Not found"} className="m-6" />;
  const membershipError = fatalQueryError(membership);
  const notMember = isApiClientError(membershipError) && membershipError.status === 404;
  const existing = membership.data;
  if (existing && existing.status !== "REJECTED") return <Navigate to={existing.status === "APPROVED" ? `/t/${slug}/app` : `/t/${slug}/pending`} replace />;
  if (membershipError && !notMember) return <ErrorBox error={membershipError} className="m-6" />;

  const t = tenant.data;
  const reapplying = existing?.status === "REJECTED";
  const inv = invitation.data ?? null;
  const prefill = inv && !existing ? { fullName: inv.fullName ?? undefined, batchYear: inv.batchYear ?? undefined, fields: Object.entries(inv.fields).map(([key, value]) => ({ key, value })) } : undefined;
  return (
    <AuthShell tenant={t} title={reapplying ? "Re-apply to join" : "Create your profile"} subtitle={reapplying ? `Previous reason: ${existing?.statusReason ?? "not given"}` : "Tell your batchmates who you are"} wide>
      {inv && (
        <p className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800" role="status">
          🎉 You were invited to {t.name}. {inv.autoApprove ? "You'll be in as soon as you save your profile." : "Save your profile and an admin will approve it."}
        </p>
      )}
      {!t.settings.allowSelfRegistration && !inv ? (
        <ErrorBox error="This institution is not accepting new registrations right now. Contact your alumni office." />
      ) : (
        <ProfileForm
          tenant={t}
          initial={existing ?? (prefill as Partial<MembershipDto> | undefined)}
          customFields={fields.data ?? []}
          mode="register"
          submitLabel={(inv ? inv.autoApprove : t.settings.memberApprovalMode === "AUTO_APPROVE") ? "Join the network" : "Submit for approval"}
          onSubmit={async (values) => {
            const m = await api.membership.register(slug, values);
            qc.setQueryData(qk.membership(slug), m);
            await qc.invalidateQueries({ queryKey: qk.me });
            toast.success(m.status === "APPROVED" ? `Welcome to ${t.name}!` : "Submitted for approval");
            navigate(m.status === "APPROVED" ? `/t/${slug}/app` : `/t/${slug}/pending`, { replace: true });
          }}
        />
      )}
    </AuthShell>
  );
}
