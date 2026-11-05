import { chatAvailable, mentorshipAvailable, type TenantFeature } from "@illuminize/shared";
import { Navigate, Outlet, useMatch } from "react-router-dom";
import { IconLock } from "@/components/icons";
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
      icon={<IconLock size={32} className="text-slate-400" />}
      title={`${label} is turned off`}
      description={`${tenant.shortName ?? tenant.name} has switched this section off.`}
      action={<LinkButton to={homePath(tenant.slug, tenant.settings.features)}>Go to the app</LinkButton>}
    />
  );
}

/**
 * Messages need one of the institution's chat switches (direct messages or groups, whose threads are here too) and a member
 * who isn't a current pupil, and the second of those isn't a section being off.
 */
export function RequireChat() {
  const { tenant, membership } = useMembership();
  // Blocked members stay open with messages off, as blocking does on the API: switching messages off in the middle of an
  // incident mustn't take away the way to block someone, or to see who's blocked.
  const onBlocked = !!useMatch("/t/:slug/app/messages/blocked");
  if (membership.chatEligible && (chatAvailable(tenant.settings.features, true) || onBlocked)) return <Outlet />;
  return (
    // Messages fill the window edge to edge on a phone, so this needs its own margin there.
    <div className="max-md:p-4">
      <EmptyState
        icon={<IconLock size={32} className="text-slate-400" />}
        title="Messages aren't available"
        description={`Private messages aren't open to your account at ${tenant.shortName ?? tenant.name}.`}
        action={<LinkButton to={homePath(tenant.slug, tenant.settings.features)}>Go to the app</LinkButton>}
      />
    </div>
  );
}

/** Groups need their switch and, like every kind of chat, a member who isn't a current pupil. */
export function RequireGroups() {
  const { tenant, membership } = useMembership();
  if (tenant.settings.features.groups && membership.chatEligible) return <Outlet />;
  return (
    <EmptyState
      icon={<IconLock size={32} className="text-slate-400" />}
      title="Groups aren't available"
      description={`Groups aren't open to your account at ${tenant.shortName ?? tenant.name}.`}
      action={<LinkButton to={homePath(tenant.slug, tenant.settings.features)}>Go to the app</LinkButton>}
    />
  );
}

/** Mentors need mentorship, which needs messaging, and a member who isn't a current pupil. */
export function RequireMentors() {
  const { tenant, membership } = useMembership();
  if (mentorshipAvailable(tenant.settings.features, membership.chatEligible)) return <Outlet />;
  return <MentorsUnavailable />;
}

/** What Mentors says to a member who can't use mentorship and has nothing in it to leave. */
export function MentorsUnavailable() {
  const { tenant } = useMembership();
  return (
    <EmptyState
      icon={<IconLock size={32} className="text-slate-400" />}
      title="Mentors aren't available"
      description={`Mentorship isn't open to your account at ${tenant.shortName ?? tenant.name}.`}
      action={<LinkButton to={homePath(tenant.slug, tenant.settings.features)}>Go to the app</LinkButton>}
    />
  );
}

/** `/t/:slug/app` → the first section the institution has enabled. */
export function AppHomeRedirect() {
  const { tenant } = useMembership();
  return <Navigate to={homePath(tenant.slug, tenant.settings.features)} replace />;
}
