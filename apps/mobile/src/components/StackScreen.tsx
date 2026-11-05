import type { Href } from "expo-router";
import type { ReactNode } from "react";
import { StyleSheet, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PageBackdrop, PageShell } from "@/components/PageBackdrop";
import { StackHeader } from "@/components/StackHeader";
import { useTheme } from "@/theme";

/**
 * Pushed stack screens that need a list/toolbar shell (not the scrolling Screen). Native header is off. `badge` and
 * `fallbackHref` go to the bar (see StackHeader). The page is the member's background (theme.page).
 */
export function StackScreen({ title, children, style, actions, badge, fallbackHref }: { title: string; children: ReactNode; style?: ViewStyle; actions?: ReactNode; badge?: string; fallbackHref?: Href }) {
  const { page } = useTheme();
  return (
    <PageShell>
      <SafeAreaView style={[styles.screen, { backgroundColor: page.color }, style]} edges={["left", "right", "bottom"]}>
        <PageBackdrop />
        <StackHeader title={title} actions={actions} badge={badge} fallbackHref={fallbackHref} />
        {children}
      </SafeAreaView>
    </PageShell>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
});
