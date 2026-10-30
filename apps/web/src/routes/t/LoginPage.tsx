import type { AuthSessionDto } from "@illuminize/shared";
import { useEffect } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { OtpLoginForm } from "@/components/auth/OtpLoginForm";
import { AuthShell } from "@/components/layout/AuthShell";
import { ErrorBox, Loading } from "@/components/ui";
import { useTenant } from "@/hooks/useTenant";
import { useTenantSlug } from "@/hooks/useTenantSlug";
import { applyTenantTheme } from "@/lib/theme";
import { useIsAuthenticated } from "@/stores/authStore";

export function nextRouteForSession(slug: string, session: AuthSessionDto): string {
  const m = session.memberships.find((x) => x.tenant.slug === slug);
  if (!m) return `/t/${slug}/register`;
  return m.status === "APPROVED" ? `/t/${slug}/app` : `/t/${slug}/pending`;
}

export function LoginPage() {
  const slug = useTenantSlug();
  const tenant = useTenant(slug);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const authed = useIsAuthenticated();
  useEffect(() => {
    if (tenant.data) applyTenantTheme(tenant.data);
  }, [tenant.data]);

  if (tenant.isLoading) return <Loading />;
  if (tenant.error || !tenant.data) return <ErrorBox error={tenant.error ?? "Not found"} className="m-6" />;
  if (authed) return <Navigate to={params.get("next") ?? `/t/${slug}/app`} replace />;

  return (
    <AuthShell tenant={tenant.data} title="Sign in" subtitle="Use the mobile number you'd like to be reached on">
      <OtpLoginForm
        onSuccess={(session) => {
          const next = params.get("next");
          navigate(next && next.startsWith("/") ? next : nextRouteForSession(slug, session), { replace: true });
        }}
      />
    </AuthShell>
  );
}
