import { useCallback, useSyncExternalStore } from "react";

/** Whether the window matches a media query, kept up to date as the window is resized. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}

/**
 * Below Tailwind's `md` (48rem), where HomeLayout swaps the sidebar for the phone's bottom bar and More sheet. What only
 * a phone needs (the feed's Explore row) renders through this rather than being hidden by CSS, so a wide screen, whose
 * sidebar lists everything, has no second copy of the section links in the page at all.
 */
export const usePhoneLayout = () => !useMediaQuery("(min-width: 48rem)");
