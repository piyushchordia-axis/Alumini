import type { ReactElement, ReactNode, Ref } from "react";
import type { RefreshControlProps, ScrollViewInstance } from "react-native";
import { Screen } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { adminHomeHref } from "@/lib/admin";
import { PlainPage } from "@/theme";

/**
 * A scrolling screen of the admin console: `Screen` with the Admin badge on its bar. With nothing to go back to (opened
 * cold, or reloaded on the web), Back goes to the console's home, and from the home itself (`home`) to the member app.
 * On the plain page, whatever background the admin chose for themselves (PlainPage).
 * `scrollRef` reaches the scroll view, to bring part of a long screen into view.
 */
export function AdminScreen({
  title,
  home = false,
  actions,
  refreshControl,
  scrollRef,
  children,
}: {
  title: string;
  home?: boolean;
  actions?: ReactNode;
  refreshControl?: ReactElement<RefreshControlProps>;
  scrollRef?: Ref<ScrollViewInstance>;
  children: ReactNode;
}) {
  const { tenant } = useMembership();
  return (
    <PlainPage>
      <Screen title={title} badge="Admin" fallbackHref={home ? undefined : adminHomeHref(tenant.slug)} actions={actions} refreshControl={refreshControl} scrollRef={scrollRef}>
        {children}
      </Screen>
    </PlainPage>
  );
}
