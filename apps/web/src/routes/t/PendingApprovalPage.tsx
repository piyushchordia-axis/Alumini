import { isApiClientError } from "@illuminize/shared/client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { AuthShell } from "@/components/layout/AuthShell";
import { Button, ErrorBox, LinkButton, Loading } from "@/components/ui";
import { useMembershipQuery } from "@/hooks/useMembership";
import { useTenant } from "@/hooks/useTenant";
import { useTenantSlug } from "@/hooks/useTenantSlug";
import { api } from "@/lib/api";
import { applyTenantTheme } from "@/lib/theme";
import { useAuthStore } from "@/stores/authStore";

export function PendingApprovalPage() {
  const slug = useTenantSlug();
  const tenant = useTenant(slug);
  const membership = useMembershipQuery(slug);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const refreshToken = useAuthStore((s) => s.refreshToken);

  useEffect(() => {
    if (tenant.data) applyTenantTheme(tenant.data);
  }, [tenant.data]);
  // Poll every 30s so an approval unlocks the app without a manual refresh.
  useEffect(() => {
    const t = setInterval(() => void membership.refetch(), 30_000);
    return () => clearInterval(t);
  }, [membership]);

  if (tenant.isLoading || membership.isLoading) return <Loading />;
  if (tenant.error || !tenant.data) return <ErrorBox error={tenant.error ?? "Not found"} className="m-6" />;
  if (membership.error) {
    if (isApiClientError(membership.error) && membership.error.status === 404) return <Navigate to={`/t/${slug}/register`} replace />;
    return <ErrorBox error={membership.error} className="m-6" />;
  }
  const m = membership.data!;
  if (m.status === "APPROVED") return <Navigate to={`/t/${slug}/app`} replace />;

  const copy = {
    PENDING: { title: "Awaiting approval", body: `Thanks ${m.fullName.split(" ")[0]}! The ${tenant.data.shortName ?? tenant.data.name} alumni office reviews every request. You'll be notified when it's approved.`, icon: "⏳" },
    REJECTED: { title: "Request not approved", body: m.statusReason ? `Reason given: ${m.statusReason}` : "Your request was not approved. You can update your details and re-apply.", icon: "✋" },
    SUSPENDED: { title: "Membership suspended", body: m.statusReason ? `Reason given: ${m.statusReason}` : "Please contact the alumni office.", icon: "⛔" },
  }[m.status as "PENDING" | "REJECTED" | "SUSPENDED"];

  return (
    <AuthShell tenant={tenant.data} title={copy.title}>
      <div className="text-center">
        <div className="text-5xl">{copy.icon}</div>
        <p className="mt-4 text-sm text-slate-600">{copy.body}</p>
        <div className="mt-6 space-y-2">
          {m.status === "REJECTED" && (
            <LinkButton to={`/t/${slug}/register`} className="w-full">
              Update details and re-apply
            </LinkButton>
          )}
          {m.status === "PENDING" && (
            <Button variant="outline" block onClick={() => void membership.refetch()} loading={membership.isFetching}>
              Check again
            </Button>
          )}
          <Button
            variant="ghost"
            block
            onClick={async () => {
              await api.auth.logout(refreshToken);
              qc.clear();
              navigate(`/t/${slug}`);
            }}
          >
            Sign out
          </Button>
        </div>
      </div>
    </AuthShell>
  );
}
