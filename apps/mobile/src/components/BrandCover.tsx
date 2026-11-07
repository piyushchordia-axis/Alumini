import { heroScrim, type TenantPublicDto } from "@illuminize/shared";
import { useIsFocused } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Image, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "@/components/ui";
import { spacing, useTheme } from "@/theme";

/** How far the card after a cover rides up over its foot. The cover keeps its hero clear of it. */
export const BRAND_COVER_OVERLAP = 56;

const HERO_MAX_SCALE = 1.5;

/**
 * An institution's brand cover, as the web's BrandCover draws it: its cover photo or its colour, its logo, its short name
 * as the hero, and under that a line (its tagline, unless `title` says otherwise). Full height on the landing screen, from
 * the top of the screen; `compact` is a shorter band for a screen that leads with its card, its hero padded below the
 * status bar. Put it in a view that leaves the top edge to it (a SafeAreaView without "top").
 *
 * The text is white on an even black veil, as dark as heroScrim says white needs over the brand colour (or any photo),
 * so it reads wherever it wraps to. The veil holds the hero rather than lying beside it, so a colour check that reads the
 * views behind the text (e2e's paintedColour, on the web build) sees it. The status bar sits on the same veil, so it is
 * light too: while the screen holding the cover is in front, and the root layout's dark one again once a screen is
 * opened over it or it goes. Only while in front, because a stack keeps the screens under the top one mounted.
 */
export function BrandCover({ tenant, title, compact = false }: { tenant: TenantPublicDto; title?: string; compact?: boolean }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const name = tenant.shortName ?? tenant.name;
  const scrim = heroScrim(theme.primary, !!tenant.coverImageUrl);
  return (
    <View style={[{ backgroundColor: theme.primary }, compact ? null : styles.full]}>
      {/* The last StatusBar mounted wins, and the root's dark one is back when this one unmounts. */}
      {focused && <StatusBar style="light" />}
      {tenant.coverImageUrl ? <Image source={{ uri: tenant.coverImageUrl }} style={StyleSheet.absoluteFill} /> : null}
      <View style={[{ backgroundColor: `rgba(0,0,0,${scrim})` }, compact ? null : styles.fill]}>
        {/* In the flow rather than pinned to the foot, so the compact band grows with large text instead of running under
            the status bar. The hero clears the card by 32 points under the full cover and 16 under the compact one, as on
            the web. */}
        <View style={[styles.hero, compact ? { paddingTop: insets.top + spacing.xl, paddingBottom: BRAND_COVER_OVERLAP + spacing.lg } : styles.heroFull]}>
          <View style={styles.row}>
            <Avatar name={name} src={tenant.logoUrl} size={56} />
            {/* Already large, so it grows only half again with the phone's text size: at the largest, a cover that grew
                with it would leave a small phone's card (the walk-through's steps) only a sliver of the screen. */}
            <View style={styles.text}>
              <Text maxFontSizeMultiplier={HERO_MAX_SCALE} style={styles.name}>
                {name}
              </Text>
              <Text maxFontSizeMultiplier={HERO_MAX_SCALE} style={styles.line}>
                {title ?? tenant.tagline ?? `${name} alumni network`}
              </Text>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  full: { height: 280 },
  fill: { flex: 1 },
  hero: { paddingHorizontal: spacing.lg },
  heroFull: { flex: 1, justifyContent: "flex-end", paddingBottom: BRAND_COVER_OVERLAP + 32 },
  row: { flexDirection: "row", alignItems: "flex-end", gap: 12 },
  text: { flex: 1 },
  name: { fontSize: 26, fontWeight: "800", color: "#fff" },
  line: { marginTop: 4, fontSize: 14, color: "#fff" },
});
