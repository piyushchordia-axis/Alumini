import { createContext, useContext, type ReactNode } from "react";
import { Image, StyleSheet, View } from "react-native";
import { useTheme } from "@/theme";

/**
 * The photo behind a page of the signed-in app (the institution's cover or the member's own), under a veil in the page
 * colour that lets through only a soft wash of it. Page shells draw it first, behind everything, and set their background
 * to `theme.page.color`; it stays put while the page scrolls over it. Touches pass through and screen readers skip it.
 * Nothing without a photo, and nothing in the admin console (PlainPage).
 */
export function PageBackdrop() {
  const { page } = useTheme();
  if (!page.imageUrl) return null;
  return (
    <View aria-hidden style={[StyleSheet.absoluteFill, { pointerEvents: "none" }]}>
      <Image source={{ uri: page.imageUrl }} resizeMode="cover" accessible={false} accessibilityIgnoresInvertColors style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: page.color, opacity: page.scrim }]} />
    </View>
  );
}

const InPageShell = createContext(false);

/** Wraps what a page shell (Screen, SectionScreen, StackScreen) holds, so a PageFill inside knows the page is drawn. */
export function PageShell({ children }: { children: ReactNode }) {
  return <InPageShell.Provider value>{children}</InPageShell.Provider>;
}

/**
 * A view that is sometimes the whole screen and sometimes inside a page shell, such as a job that can't be shown. On its
 * own it draws the page itself, its colour and PageBackdrop; inside a shell it leaves its background clear, so the
 * shell's page, photo included, shows through without a seam.
 */
export function PageFill({ children }: { children: ReactNode }) {
  const inShell = useContext(InPageShell);
  const { page } = useTheme();
  return (
    <View style={[styles.fill, inShell ? null : { backgroundColor: page.color }]}>
      {!inShell && <PageBackdrop />}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
