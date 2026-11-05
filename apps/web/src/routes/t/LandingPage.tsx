import { countryName } from "@illuminize/shared";
import { isApiClientError } from "@illuminize/shared/client";
import { useEffect } from "react";
import { Navigate } from "react-router-dom";
import { SignedInAs } from "@/components/auth/SignedInAs";
import { IconBusinesses, IconDirectory, IconEvents, IconFeed, IconFunding, IconJobs } from "@/components/icons";
import { AuthShell } from "@/components/layout/AuthShell";
import { ErrorBox, LinkButton, Loading } from "@/components/ui";
import { useMembershipQuery } from "@/hooks/useMembership";
import { useSignOut } from "@/hooks/useSignOut";
import { useTenant } from "@/hooks/useTenant";
import { useTenantSlug } from "@/hooks/useTenantSlug";
import { applyTenantTheme } from "@/lib/theme";
import { useAuthStore, useIsAuthenticated } from "@/stores/authStore";
import { useUiStore } from "@/stores/uiStore";

export function LandingPage() {
  const slug = useTenantSlug();
  const tenant = useTenant(slug);
  const authed = useIsAuthenticated();
  const membership = useMembershipQuery(slug);
  const phone = useAuthStore((s) => s.user?.phone ?? null);
  const signOut = useSignOut();
  const last = useUiStore((s) => s.lastTenantSlug);
  const setLast = useUiStore((s) => s.setLastTenantSlug);
  // Signed in but not a member here: they stay, to join or to sign in with another number. Sending them straight into a
  // fresh registration form made that form's Back bring them right back to it. Anyone else goes into the app, which
  // deals with a membership waiting, refused, or one that couldn't be checked.
  const error = membership.error;
  const notMember = authed && !membership.data && isApiClientError(error) && (error.status === 404 || error.code === "NOT_A_MEMBER");
  useEffect(() => {
    if (tenant.data) applyTenantTheme(tenant.data);
  }, [tenant.data]);
  // Nor is it the institution to start at, as the app's own guard decides once a membership is refused: the picker
  // (Choose a different institution, below) would send them back into the app here, and on into a fresh form.
  useEffect(() => {
    if (notMember && last === slug) setLast(null);
  }, [notMember, last, slug, setLast]);

  if (tenant.isLoading || (authed && membership.isLoading)) return <Loading />;
  if (tenant.error || !tenant.data) return <ErrorBox error={tenant.error ?? "Not found"} className="m-6" />;
  if (authed && !notMember) return <Navigate to={`/t/${slug}/app`} replace />;
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
          {authed ? (
            <>
              <LinkButton to={`/t/${slug}/register`} className="w-full">
                Join {t.shortName ?? t.name}
              </LinkButton>
              <SignedInAs phone={phone} onUseDifferentNumber={() => void signOut(`/t/${slug}/login`)} className="justify-center" />
            </>
          ) : (
            <LinkButton to={`/t/${slug}/login`} className="w-full">
              Sign in / Join with your mobile number
            </LinkButton>
          )}
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
