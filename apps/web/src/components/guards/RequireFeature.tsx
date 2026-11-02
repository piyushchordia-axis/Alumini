import type { TenantFeature } from "@illuminize/shared";
import { Navigate, Outlet } from "react-router-dom";
import { EmptyState, LinkButton } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { homePath, SECTION_LINKS, type SectionLink } from "@/lib/sections";

/** Sections and feature keys overlap but aren't the same list, so a key may have no link to take its name from. */
const LINKS_BY_FEATURE: Partial<Record<TenantFeature, SectionLink>> = SECTION_LINKS;

/** Hides a section the institution has switched off, including deep links to it. */
export function RequireFeature({ feature }: { feature: TenantFeature }) {
  const { tenant } = useMembership();
  if (tenant.settings.features[feature]) return <Outlet />;
  const label = LINKS_BY_FEATURE[feature]?.label ?? feature;
  return (
    <EmptyState
      icon="🔒"
      title={`${label} is turned off`}
      description={`${tenant.shortName ?? tenant.name} has switched this section off.`}
      action={<LinkButton to={homePath(tenant.slug, tenant.settings.features)}>Go to the app</LinkButton>}
    />
  );
}

/** `/t/:slug/app` → the first section the institution has enabled. */
export function AppHomeRedirect() {
  const { tenant } = useMembership();
  return <Navigate to={homePath(tenant.slug, tenant.settings.features)} replace />;
}
