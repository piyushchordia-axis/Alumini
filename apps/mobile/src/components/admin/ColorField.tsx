import { BRAND_SWATCHES, isHexColour, isSwatchChosen, normalizeHexInput, swatchLabel } from "@illuminize/shared";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { IconAlert, IconCheck } from "@/components/icons";
import { Input } from "@/components/ui";
import { colors, radius, spacing } from "@/theme";

/**
 * One of the institution's colours: a swatch of it beside its hex code (the box keeps what's typed as normalizeHexInput
 * writes it), then the suggested colours as radios. `error` is why it can't be saved; `warning` what it will do to the
 * apps (brandContrastWarnings), which never stops a save. The web console's twin also has the browser's colour picker.
 */
export function ColorField({ label, value, onChange, placeholder, error, warning }: { label: string; value: string; onChange: (hex: string) => void; placeholder?: string; error?: string; warning?: string }) {
  const valid = isHexColour(value);
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.entry}>
        {/* Empty, with a dashed edge, until the box holds a colour. */}
        <View aria-hidden style={[styles.preview, valid ? { backgroundColor: value.trim() } : styles.previewEmpty]} />
        <View style={{ flex: 1 }}>
          <Input
            accessibilityLabel={`${label} hex code`}
            value={value}
            onChangeText={(text) => onChange(normalizeHexInput(text))}
            placeholder={placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            spellCheck={false}
            maxLength={7}
            error={error}
          />
        </View>
      </View>
      <View accessibilityRole="radiogroup" accessibilityLabel={`Suggested ${label.toLowerCase()}s`} style={styles.swatches}>
        {BRAND_SWATCHES.map((swatch) => {
          const chosen = isSwatchChosen(swatch, value);
          return (
            <Pressable
              key={swatch.hex}
              onPress={() => onChange(swatch.hex)}
              accessibilityRole="radio"
              accessibilityLabel={swatchLabel(swatch)}
              // aria-checked rather than accessibilityState: React Native maps it on devices, and react-native-web only emits the ARIA form.
              aria-checked={chosen}
              style={({ pressed }) => [styles.swatch, chosen ? styles.swatchChosen : null, { opacity: pressed ? 0.7 : 1 }]}
            >
              {/* Every suggested colour takes white at 4.5:1 or better. */}
              <View style={[styles.dot, { backgroundColor: swatch.hex }]}>{chosen && <IconCheck size={16} strokeWidth={2.75} color="#ffffff" />}</View>
            </Pressable>
          );
        })}
      </View>
      {warning ? (
        <View style={styles.warning}>
          <IconAlert size={16} color={WARNING_INK} />
          <Text style={styles.warningText}>{warning}</Text>
        </View>
      ) : null}
    </View>
  );
}

const WARNING_INK = "#92400e";

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: "600", color: "#334155" },
  entry: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  // As tall as the box beside it.
  preview: { width: 44, height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: "rgba(15,23,42,0.12)" },
  previewEmpty: { borderStyle: "dashed", borderColor: colors.borderStrong, backgroundColor: "#f8fafc" },
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  // A 44-point target, with a ring round the chosen one.
  swatch: { width: 44, height: 44, borderRadius: radius.full, borderWidth: 2, borderColor: "transparent", alignItems: "center", justifyContent: "center" },
  swatchChosen: { borderColor: colors.text },
  dot: { width: 34, height: 34, borderRadius: radius.full, alignItems: "center", justifyContent: "center" },
  warning: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, backgroundColor: "#fffbeb", borderWidth: 1, borderColor: "#fde68a" },
  warningText: { flex: 1, fontSize: 13, lineHeight: 18, color: WARNING_INK },
});
