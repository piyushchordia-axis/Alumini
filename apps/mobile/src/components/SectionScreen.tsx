import type { ReactNode } from "react";
import { StyleSheet, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MemberAppBar } from "@/components/MemberAppBar";
import { colors } from "@/theme";

/**
 * Tab list roots (search, filters, section tabs). Renders the in-tree institution bar (status-bar safe) and clears
 * left/right/bottom insets. Native stack headers are off on these screens so content cannot draw under them.
 */
export function SectionScreen({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return (
    <SafeAreaView style={[styles.screen, style]} edges={["left", "right", "bottom"]}>
      <MemberAppBar />
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
});
