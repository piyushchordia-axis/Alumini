import { useSyncExternalStore } from "react";

export interface VisualViewportSize {
  /** The height the member can actually see, which an on-screen keyboard takes from. */
  height: number;
  /** How far the visible part has scrolled down the page, which iOS Safari does when the keyboard opens. */
  offsetTop: number;
  /** An on-screen keyboard is probably open: the visible part is well short of the window. */
  keyboardOpen: boolean;
}

function subscribe(onChange: () => void) {
  const viewport = window.visualViewport;
  if (!viewport) return () => {};
  viewport.addEventListener("resize", onChange);
  viewport.addEventListener("scroll", onChange);
  return () => {
    viewport.removeEventListener("resize", onChange);
    viewport.removeEventListener("scroll", onChange);
  };
}

// A string, because the store compares snapshots by identity and a new object each time would render forever.
const snapshot = () => {
  const viewport = window.visualViewport;
  return viewport ? `${Math.round(viewport.height)}:${Math.round(viewport.offsetTop)}:${window.innerHeight}` : "";
};

/**
 * The visible part of the window, or null where the browser can't say. Mobile browsers open the keyboard over the page
 * rather than shrinking it, so a screen that must keep its composer in view sizes itself to this.
 */
export function useVisualViewport(): VisualViewportSize | null {
  const value = useSyncExternalStore(subscribe, snapshot, () => "");
  if (!value) return null;
  const [height = 0, offsetTop = 0, windowHeight = 0] = value.split(":").map(Number);
  return { height, offsetTop, keyboardOpen: height < windowHeight * 0.85 };
}
