import type { Href } from "expo-router";
import type { ReactNode } from "react";
import { StyleSheet, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StackHeader } from "@/components/StackHeader";
import { colors } from "@/theme";

/** Pushed stack screens that need a list/toolbar shell (not the scrolling Screen). Native header is off. `badge` and `fallbackHref` go to the bar (see StackHeader). */
export function StackScreen({ title, children, style, actions, badge, fallbackHref }: { title: string; children: ReactNode; style?: ViewStyle; actions?: ReactNode; badge?: string; fallbackHref?: Href }) {
  return (
    <SafeAreaView style={[styles.screen, style]} edges={["left", "right", "bottom"]}>
      <StackHeader title={title} actions={actions} badge={badge} fallbackHref={fallbackHref} />
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
});
