import { chatAvailable, type TenantFeature } from "@illuminize/shared";
import { Redirect } from "expo-router";
import type { ReactNode } from "react";
import { useMembership } from "@/hooks/useMembership";
import { homeHref } from "@/lib/sections";

export { MemberAppBar } from "@/components/MemberAppBar";

/** Wraps a tab's stack: if the institution has switched the section off, go to the first enabled one instead. */
export function FeatureGate({ feature, children }: { feature: TenantFeature; children: ReactNode }) {
  const { tenant } = useMembership();
  if (!tenant.settings.features[feature]) return <Redirect href={homeHref(tenant.slug, tenant.settings.features)} />;
  return <>{children}</>;
}

/** The same for Messages, which holds direct chats and groups, and also needs a member who isn't a current pupil. */
export function ChatGate({ children }: { children: ReactNode }) {
  const { tenant, membership } = useMembership();
  if (!chatAvailable(tenant.settings.features, membership.chatEligible)) return <Redirect href={homeHref(tenant.slug, tenant.settings.features)} />;
  return <>{children}</>;
}

/** The same for Groups. */
export function GroupsGate({ children }: { children: ReactNode }) {
  const { tenant, membership } = useMembership();
  if (!tenant.settings.features.groups || !membership.chatEligible) return <Redirect href={homeHref(tenant.slug, tenant.settings.features)} />;
  return <>{children}</>;
}
