import { useMatches } from "react-router-dom";

/** What a route asks of the member layout, through its `handle`. A child's handle adds to its parents'. */
export interface AppRouteHandle {
  /** Fills the height of the window and scrolls inside, as a chat does, instead of scrolling the page. */
  fullHeight?: boolean;
  /** On phones, takes the whole screen: no header and no bottom bar, which are removed rather than covered so focus can't reach them. */
  immersive?: boolean;
}

export function useAppRouteHandle(): AppRouteHandle {
  const matches = useMatches();
  return matches.reduce<AppRouteHandle>((all, match) => ({ ...all, ...(match.handle as AppRouteHandle | undefined) }), {});
}
