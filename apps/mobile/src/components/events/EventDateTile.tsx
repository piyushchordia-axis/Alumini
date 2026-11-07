import { Text, View } from "react-native";
import { colors, useTheme } from "@/theme";

const SIZES = {
  md: { box: 56, radius: 10, day: 22 },
  sm: { box: 48, radius: 8, day: 18 },
} as const;

/**
 * An event's day, on its card and on the feed's Upcoming events strip, as the web app draws it: on the brand's wash,
 * the month in the grey that reads on any wash (`colors.secondary`) and the day in the ink, each at 4.5:1 for any
 * institution colour. Screen readers skip it, as the line beside it, or the link's name, gives the date in full. It
 * grows with the text size up to a point, rather than holding its box while the numbers spill out of it, but never
 * stretches to the height of a row it sits in.
 */
export function EventDateTile({ startAt, timezone, size = "md" }: { startAt: string; timezone: string; size?: keyof typeof SIZES }) {
  const theme = useTheme();
  const d = new Date(startAt);
  const s = SIZES[size];
  return (
    <View aria-hidden style={{ alignSelf: "flex-start", minWidth: s.box, minHeight: s.box, paddingHorizontal: 4, borderRadius: s.radius, backgroundColor: theme.primaryWash, alignItems: "center", justifyContent: "center" }}>
      <Text maxFontSizeMultiplier={1.5} style={{ color: colors.secondary, fontSize: 11, lineHeight: 14, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase" }}>
        {d.toLocaleString(undefined, { month: "short", timeZone: timezone })}
      </Text>
      <Text maxFontSizeMultiplier={1.5} style={{ color: theme.primaryInk, fontSize: s.day, lineHeight: s.day + 2, fontWeight: "800" }}>
        {d.toLocaleString(undefined, { day: "numeric", timeZone: timezone })}
      </Text>
    </View>
  );
}
