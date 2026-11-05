import type { ReactNode } from "react";
import { StyleSheet, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MemberAppBar } from "@/components/MemberAppBar";
import { PageBackdrop, PageShell } from "@/components/PageBackdrop";
import { useTheme } from "@/theme";

/**
 * Tab list roots (search, filters, section tabs). Renders the in-tree institution bar (status-bar safe) and clears
 * left/right/bottom insets. Native stack headers are off on these screens so content cannot draw under them. The page
 * is the member's background (theme.page).
 */
export function SectionScreen({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const { page } = useTheme();
  return (
    <PageShell>
      <SafeAreaView style={[styles.screen, { backgroundColor: page.color }, style]} edges={["left", "right", "bottom"]}>
        <PageBackdrop />
        <MemberAppBar />
        {children}
      </SafeAreaView>
    </PageShell>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
});
