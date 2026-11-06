import type { StatusTab } from "@illuminize/shared";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Tabs } from "@/components/ui";
import { spacing } from "@/theme";

/**
 * The bar above a queue's list (moderation, reports): its status tabs, with the dashboard's counts, and any filter under
 * them. It sits outside the list, so the filters stay in reach while a long preview scrolls.
 */
export function QueueToolbar<S extends string>({ tabs, value, onChange, children }: { tabs: StatusTab<S>[]; value: S; onChange: (next: S) => void; children?: ReactNode }) {
  return (
    <View style={styles.toolbar}>
      <Tabs tall value={value} onChange={onChange} tabs={tabs} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, gap: spacing.sm },
});
