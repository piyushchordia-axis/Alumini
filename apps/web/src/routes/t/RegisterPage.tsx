import { isApiClientError } from "@illuminize/shared/client";
import { useQueryClient } from "@tanstack/react-query";
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
  const membership = useMembershipQuery(slug);
  const fields = useProfileFields(slug);
  const navigate = useNavigate();
  const qc = useQueryClient();
  useEffect(() => {
    if (tenant.data) applyTenantTheme(tenant.data);
  }, [tenant.data]);

  if (tenant.isLoading || membership.isLoading || fields.isLoading) return <Loading />;
  if (tenant.error || !tenant.data) return <ErrorBox error={tenant.error ?? "Not found"} className="m-6" />;
  const existing = membership.data;
  if (existing && existing.status !== "REJECTED") return <Navigate to={existing.status === "APPROVED" ? `/t/${slug}/app` : `/t/${slug}/pending`} replace />;
  if (membership.error && !(isApiClientError(membership.error) && membership.error.status === 404)) return <ErrorBox error={membership.error} className="m-6" />;

  const t = tenant.data;
  const reapplying = existing?.status === "REJECTED";
  return (
    <AuthShell tenant={t} title={reapplying ? "Re-apply to join" : "Create your profile"} subtitle={reapplying ? `Previous reason: ${existing?.statusReason ?? "not given"}` : "Tell your batchmates who you are"} wide>
      {!t.settings.allowSelfRegistration ? (
        <ErrorBox error="This institution is not accepting new registrations right now. Contact your alumni office." />
      ) : (
        <ProfileForm
          tenant={t}
          initial={existing ?? undefined}
          customFields={fields.data ?? []}
          mode="register"
          submitLabel={t.settings.memberApprovalMode === "ADMIN_APPROVAL" ? "Submit for approval" : "Join the network"}
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
