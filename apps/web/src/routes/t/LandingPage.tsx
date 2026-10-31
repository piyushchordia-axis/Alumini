import { countryName } from "@illuminize/shared";
import { useEffect } from "react";
import { Navigate } from "react-router-dom";
import { AuthShell } from "@/components/layout/AuthShell";
import { ErrorBox, LinkButton, Loading } from "@/components/ui";
import { useTenant } from "@/hooks/useTenant";
import { useTenantSlug } from "@/hooks/useTenantSlug";
import { applyTenantTheme } from "@/lib/theme";
import { useIsAuthenticated } from "@/stores/authStore";

export function LandingPage() {
  const slug = useTenantSlug();
  const tenant = useTenant(slug);
  const authed = useIsAuthenticated();
  useEffect(() => {
    if (tenant.data) applyTenantTheme(tenant.data);
  }, [tenant.data]);

  if (tenant.isLoading) return <Loading />;
  if (tenant.error || !tenant.data) return <ErrorBox error={tenant.error ?? "Not found"} className="m-6" />;
  if (authed) return <Navigate to={`/t/${slug}/app`} replace />;
  const t = tenant.data;
  return (
    <AuthShell tenant={t} title={t.tagline ?? `${t.shortName ?? t.name} alumni network`} subtitle={[t.city, countryName(t.country)].filter(Boolean).join(", ")}>
      {t.welcomeMessage && <p className="whitespace-pre-line text-sm text-slate-600">{t.welcomeMessage}</p>}
      <ul className="mt-4 grid grid-cols-2 gap-2 text-sm text-slate-600">
        {t.settings.features.feed && <li>💬 Community feed</li>}
        {t.settings.features.jobs && <li>💼 Jobs &amp; referrals</li>}
        {t.settings.features.funding && <li>🚀 Funding &amp; investors</li>}
        {t.settings.features.events && <li>📅 Meetups &amp; events</li>}
        {t.settings.features.directory && <li>🎓 Batch directory</li>}
      </ul>
      <div className="mt-6 space-y-2">
        <LinkButton to={`/t/${slug}/login`} className="w-full">
          Sign in / Join with your mobile number
        </LinkButton>
        <p className="text-center text-xs text-slate-500">
          {t.settings.memberApprovalMode === "ADMIN_APPROVAL" ? "New members are verified by the alumni office before access." : "New members get instant access."}
        </p>
      </div>
    </AuthShell>
  );
}
