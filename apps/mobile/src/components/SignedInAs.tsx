import { formatPhone } from "@illuminize/shared";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { IconPhone } from "@/components/icons";
import { colors, spacing, useTheme } from "@/theme";

/**
 * "Signed in as +91 98765 43210", then "Use a different number", on registration's first step and on the landing screen
 * of an institution they haven't joined, as on the web app: the number the code went to, so a wrong one is noticed
 * before joining with it.
 */
export function SignedInAs({ phone, onUseDifferentNumber, centered = false }: { phone: string | null | undefined; onUseDifferentNumber: () => void; centered?: boolean }) {
  const theme = useTheme();
  return (
    <View style={[styles.row, centered ? styles.centered : null]}>
      {phone ? (
        <View style={styles.signedIn}>
          <IconPhone size={16} color={colors.faint} />
          <Text style={styles.text}>
            Signed in as <Text style={styles.number}>{formatPhone(phone)}</Text>
          </Text>
        </View>
      ) : null}
      <Pressable onPress={onUseDifferentNumber} accessibilityRole="button" style={({ pressed }) => [styles.button, pressed ? styles.pressed : null]}>
        <Text style={[styles.link, { color: theme.primaryInk }]}>Use a different number</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // On a narrow screen the button wraps under the number, whole.
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: spacing.md },
  centered: { justifyContent: "center" },
  signedIn: { flexDirection: "row", alignItems: "center", gap: 6 },
  text: { fontSize: 14, color: colors.muted },
  number: { fontWeight: "600", color: colors.text },
  // A 44pt target, however short the line.
  button: { minHeight: 44, justifyContent: "center" },
  pressed: { opacity: 0.6 },
  link: { fontSize: 14, fontWeight: "600" },
});
