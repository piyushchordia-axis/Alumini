import { countryName } from "@illuminize/shared";
import { useEffect } from "react";
import { Navigate } from "react-router-dom";
import { IconBusinesses, IconDirectory, IconEvents, IconFeed, IconFunding, IconJobs } from "@/components/icons";
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
  const place = [t.city, countryName(t.country)].filter(Boolean).join(", ");
  const features = [
    t.settings.features.feed && { icon: IconFeed, label: "Community feed" },
    t.settings.features.jobs && { icon: IconJobs, label: "Jobs & referrals" },
    t.settings.features.funding && { icon: IconFunding, label: "Funding & investors" },
    t.settings.features.events && { icon: IconEvents, label: "Meetups & events" },
    t.settings.features.businesses && { icon: IconBusinesses, label: "Alumni businesses" },
    t.settings.features.directory && { icon: IconDirectory, label: "Batch directory" },
  ].filter(Boolean) as { icon: typeof IconFeed; label: string }[];

  return (
    <AuthShell tenant={t} title={t.tagline ?? `${t.shortName ?? t.name} alumni network`} subtitle={place}>
      <div className="space-y-5">
        {t.welcomeMessage && <p className="whitespace-pre-line text-sm leading-relaxed text-slate-600">{t.welcomeMessage}</p>}
        <div className="space-y-2">
          <LinkButton to={`/t/${slug}/login`} className="w-full">
            Sign in / Join with your mobile number
          </LinkButton>
          <p className="text-center text-xs text-slate-500">
            {t.settings.memberApprovalMode === "ADMIN_APPROVAL" ? "New members are verified by the alumni office before access." : "New members get instant access."}
          </p>
        </div>
        {features.length > 0 && (
          <ul className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-slate-100 pt-4 text-sm text-slate-600">
            {features.map((f) => (
              <li key={f.label} className="flex items-center gap-2">
                <f.icon size={16} className="text-primary" />
                <span>{f.label}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AuthShell>
  );
}
