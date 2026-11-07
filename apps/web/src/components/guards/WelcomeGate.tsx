import { welcomeDue } from "@illuminize/shared";
import type { ReactNode } from "react";
import { Navigate, useMatch } from "react-router-dom";
import { useMembership } from "@/hooks/useMembership";

/**
 * The front door, `/t/:slug/app`, opens the first-entry walk-through for a member who is owed it, in place of their home
 * section (AppHomeRedirect). Every other address (a link, a notification, `?next=` after signing in) opens its own page,
 * and the walk-through waits for the next time they come in at the front door. It wraps the app's chrome, so that never
 * draws on the way there.
 */
export function WelcomeGate({ children }: { children: ReactNode }) {
  const { tenant, membership } = useMembership();
  const atFrontDoor = !!useMatch("/t/:slug/app");
  if (atFrontDoor && welcomeDue(membership)) return <Navigate to={`/t/${tenant.slug}/welcome`} replace />;
  return children;
}
