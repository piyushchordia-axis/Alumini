import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useCallback } from "react";

/**
 * Leaves a screen above the tabs (the admin console, the walk-through) for `href` once it's in front, as Redirect does on
 * focus, but with dismissTo: down to the tabs when they're underneath, or in this screen's place when they aren't, never
 * a second set of tabs on top. `withAnchor` puts the anchor of each stack it opens under `href`, so Back from a screen
 * deep in a tab (Edit profile) has that tab's first screen to go to.
 */
export function DismissTo({ href, withAnchor = false }: { href: Href; withAnchor?: boolean }) {
  const router = useRouter();
  useFocusEffect(
    useCallback(() => {
      router.dismissTo(href, withAnchor ? { withAnchor } : undefined);
    }, [router, href, withAnchor]),
  );
  return null;
}
