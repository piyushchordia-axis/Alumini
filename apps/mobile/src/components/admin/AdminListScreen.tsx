import type { ReactNode } from "react";
import { StackScreen } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { adminHomeHref } from "@/lib/admin";
import { PlainPage } from "@/theme";

/**
 * A list screen of the admin console (a FlatList under the bar, not the scrolling AdminScreen): `StackScreen` with the
 * Admin badge, whose Back goes to the console's home when there's nothing to go back to. On the plain page, as AdminScreen.
 */
export function AdminListScreen({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  const { tenant } = useMembership();
  return (
    <PlainPage>
      <StackScreen title={title} badge="Admin" fallbackHref={adminHomeHref(tenant.slug)} actions={actions}>
        {children}
      </StackScreen>
    </PlainPage>
  );
}
