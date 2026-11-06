import { brandPreviewText, type BrandPreviewColours } from "@illuminize/shared";
import { useId } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Defs, LinearGradient, Rect, Stop, Svg } from "react-native-svg";
import { Avatar } from "@/components/ui";
import { colors, radius, spacing, ThemeProvider } from "@/theme";

/**
 * The institution's look as the Branding form has it, before it's saved: the logo, name and tagline on a gradient from
 * the primary to the secondary colour (brandPreviewColours, which holds a half-typed colour back), as on the web console.
 * Read as one image, by what it says.
 */
export function BrandPreview({
  name,
  shortName,
  tagline,
  logoUrl,
  colours,
}: {
  name: string;
  shortName: string | null;
  tagline: string | null;
  logoUrl: string | null;
  colours: BrandPreviewColours;
}) {
  // An SVG id is the whole page's on the web build, and useId's own characters can't go in url(#…).
  const gradient = `brand-preview-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  // The same words as the web console's preview.
  const { title, initialsOf, tagline: line } = brandPreviewText({ name, shortName, tagline });
  return (
    <View accessible role="img" aria-label={["Preview", title, line].filter(Boolean).join(", ")} style={styles.card}>
      <Svg width="100%" height="100%" preserveAspectRatio="none" style={StyleSheet.absoluteFill} aria-hidden>
        <Defs>
          {/* Corner to corner, as the web console's 135° CSS gradient. */}
          <LinearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={colours.from} />
            <Stop offset="1" stopColor={colours.to} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradient})`} />
      </Svg>
      {/* On white, so the initials' brand tint doesn't vanish into the brand gradient; in the colours being chosen. */}
      <View style={styles.logo}>
        <ThemeProvider tenant={{ primaryColor: colours.from, secondaryColor: colours.to }}>
          <Avatar name={initialsOf} src={logoUrl} size={56} />
        </ThemeProvider>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.caption, { color: colours.text }]}>Preview</Text>
        <Text style={[styles.name, { color: colours.text }]}>{title}</Text>
        {line && <Text style={[styles.tagline, { color: colours.text }]}>{line}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: spacing.lg, minHeight: 96, padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  logo: { padding: 2, borderRadius: radius.full, backgroundColor: "#ffffff" },
  caption: { fontSize: 11, fontWeight: "600", letterSpacing: 0.6, textTransform: "uppercase", opacity: 0.8 },
  name: { fontSize: 17, fontWeight: "700" },
  tagline: { fontSize: 14, opacity: 0.9 },
});
