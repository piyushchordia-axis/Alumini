import type { ReactElement, ReactNode } from "react";
import type { RefreshControlProps } from "react-native";
import { Screen } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { adminHomeHref } from "@/lib/admin";

/**
 * A scrolling screen of the admin console: `Screen` with the Admin badge on its bar. With nothing to go back to (opened
 * cold, or reloaded on the web), Back goes to the console's home, and from the home itself (`home`) to the member app.
 */
export function AdminScreen({
  title,
  home = false,
  actions,
  refreshControl,
  children,
}: {
  title: string;
  home?: boolean;
  actions?: ReactNode;
  refreshControl?: ReactElement<RefreshControlProps>;
  children: ReactNode;
}) {
  const { tenant } = useMembership();
  return (
    <Screen title={title} badge="Admin" fallbackHref={home ? undefined : adminHomeHref(tenant.slug)} actions={actions} refreshControl={refreshControl}>
      {children}
    </Screen>
  );
}
