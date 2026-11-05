import { useQueryClient } from "@tanstack/react-query";
import { Stack, useFocusEffect, useRouter, type Href } from "expo-router";
import { useCallback } from "react";
import { useAdminDashboard } from "@/hooks/useAdminDashboard";
import { useMembership } from "@/hooks/useMembership";
import { qk } from "@/lib/queryKeys";
import { homeHref } from "@/lib/sections";

/** The console's home under a section opened straight from a push or a link, so Back has somewhere in the console to go. */
export const unstable_settings = { anchor: "index" };

/**
 * Back to the member app once this screen is in front, as Redirect does on focus, but down to the tabs underneath
 * rather than replacing the console with a second set of tabs.
 */
function LeaveConsole({ href }: { href: Href }) {
  const router = useRouter();
  useFocusEffect(
    useCallback(() => {
      router.dismissTo(href);
    }, [router, href]),
  );
  return null;
}

/**
 * The institution's admin console: a stack above the tabs, like the web's AdminLayout, for admins with an approved
 * membership (the (app) layout has checked it; Illuminize staff who aren't members use the web console). The
 * membership is fetched again whenever the console comes to the front, and after any admin query is refused (see
 * lib/queryClient.ts), so someone who is no longer an admin is taken back to the member app. The console's counts
 * are polled here, for its home and for the sections it lists.
 */
export default function AdminLayout() {
  const { tenant, isTenantAdmin } = useMembership();
  const slug = tenant.slug;
  const qc = useQueryClient();
  useAdminDashboard(slug, { enabled: isTenantAdmin, poll: true });
  useFocusEffect(
    useCallback(() => {
      void qc.invalidateQueries({ queryKey: qk.membership(slug), exact: true });
    }, [qc, slug]),
  );
  if (!isTenantAdmin) return <LeaveConsole href={homeHref(slug, tenant.settings.features)} />;
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="profile-fields/edit" options={{ presentation: "modal" }} />
    </Stack>
  );
}
