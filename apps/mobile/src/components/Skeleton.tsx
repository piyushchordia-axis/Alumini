import { LOADING_LABEL, SKELETON_LAYOUTS, skeletonWidth, type SkeletonFrame, type SkeletonLayout, type SkeletonLead, type SkeletonShape } from "@illuminize/shared";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Animated, Easing, Platform, View, type DimensionValue, type StyleProp, type ViewStyle } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { colors, elevation, radius, spacing } from "@/theme";

// Outlines drawn while something first loads, from the layouts the web's (ui/Skeleton.tsx) draws too. Neutral slate on
// white, never the brand colour, so they read on any institution's colour and on any member's background. ui.tsx imports
// this file (ListEmpty draws it), so the white surfaces are written out here rather than taken from Card.

/** slate-200, the web's blocks. */
const BLOCK = "#e2e8f0";
const SURFACE: ViewStyle = { backgroundColor: colors.card, borderRadius: radius.lg, ...elevation[1] };
const HAIRLINE: ViewStyle = { borderTopWidth: 1, borderTopColor: colors.border };
const BAND_ROW: ViewStyle = { backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: spacing.md, paddingHorizontal: spacing.lg };

/**
 * The phone's frames: the shared ones, and `band`, for rows that run the screen's full width (Messages, Notifications):
 * each white with a hairline under it and padded as theirs are, with no corners, shadow or margin, so nothing moves when
 * they come.
 */
export type PhoneSkeletonFrame = SkeletonFrame | "band";

/** The pulse of the outline a block is in: its group's one opacity, which every block takes and no white surface does. */
const Pulse = createContext<Animated.Value | null>(null);

/** One grey block of an outline, pulsing with its group's other blocks. */
export function SkeletonBox({ width, height, corner = 4, style }: { width: DimensionValue; height: number; corner?: number; style?: StyleProp<ViewStyle> }) {
  const opacity = useContext(Pulse);
  return <Animated.View style={[{ width, height, borderRadius: corner, backgroundColor: BLOCK }, style, opacity ? { opacity } : null]} />;
}

/**
 * Says something is loading while its outline shows: one progressbar named `label`, with the outline hidden from screen
 * readers. Its blocks pulse gently, the white cards under them staying opaque (faded, a card would let the member's tint
 * or photo through), unless the phone is set to reduce motion (reanimated's useReducedMotion, which reads the setting as
 * the app starts). `testID="skeleton"` is there for the e2e scripts alone.
 */
export function SkeletonGroup({ label = LOADING_LABEL, style, children }: { label?: string; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const reduced = useReducedMotion();
  // One value for the whole outline, so its blocks pulse as one. State rather than a ref, so render never reads a ref;
  // react-native-web has no useAnimatedValue.
  const [opacity] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (reduced) return;
    const fade = (toValue: number) => Animated.timing(opacity, { toValue, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: Platform.OS !== "web" });
    const pulse = Animated.loop(Animated.sequence([fade(0.55), fade(1)]));
    pulse.start();
    return () => pulse.stop();
  }, [reduced, opacity]);
  return (
    <View testID="skeleton" accessible accessibilityRole="progressbar" accessibilityLabel={label} style={style}>
      <View aria-hidden>
        <Pulse.Provider value={opacity}>{children}</Pulse.Provider>
      </View>
    </View>
  );
}

const pct = (base: number, row: number): DimensionValue => `${skeletonWidth(base, row)}%`;

/** Lines of text, each a percentage of the width it has, shorter on each of three rows in turn. */
export function SkeletonLines({ widths, row = 0, style }: { widths: readonly number[]; row?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ gap: spacing.sm }, style]}>
      {widths.map((w, i) => (
        <SkeletonBox key={i} width={pct(w, row)} height={10} />
      ))}
    </View>
  );
}

/** The corners of what leads an item, as the real thing's: a round photo, a company's logo tile, an event's date block. */
const leadCorner = (lead: SkeletonLead) => (lead.kind === "circle" ? lead.phoneSize / 2 : lead.kind === "square" ? radius.md : 10);

function Item({ layout, row }: { layout: SkeletonLayout; row: number }) {
  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ flexDirection: "row", alignItems: layout.body.length > 0 ? "flex-start" : "center", gap: spacing.md }}>
        {layout.lead && <SkeletonBox width={layout.lead.phoneSize} height={layout.lead.phoneSize} corner={leadCorner(layout.lead)} />}
        <View style={{ flex: 1, minWidth: 0, gap: spacing.sm }}>
          {layout.lines.map((w, i) => (
            // The title is a little taller than the lines under it.
            <SkeletonBox key={i} width={pct(w, row)} height={i === 0 ? 14 : 10} />
          ))}
        </View>
        {/* A console row's action shows only on a wide web screen, so never here. */}
        {layout.trailing === "time" && <SkeletonBox width={36} height={10} style={{ alignSelf: "flex-start" }} />}
      </View>
      {layout.body.length > 0 && <SkeletonLines widths={layout.body} row={row} />}
      {layout.pills > 0 && (
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          {Array.from({ length: layout.pills }, (_, i) => (
            <SkeletonBox key={i} width={64} height={28} corner={radius.full} />
          ))}
        </View>
      )}
    </View>
  );
}

function TableRows({ layout, count, inset }: { layout: SkeletonLayout; count: number; inset: boolean }) {
  const cells = (widths: readonly number[], row: number) =>
    widths.map((w, i) => (
      <View key={i} style={{ flex: 1 }}>
        <SkeletonBox width={pct(w, row)} height={10} />
      </View>
    ));
  const line: ViewStyle = { flexDirection: "row", gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: inset ? spacing.lg : 0 };
  return (
    <>
      {/* The header bar keeps inside the card's rounded corners. */}
      <View style={[line, { backgroundColor: "#f8fafc", borderTopLeftRadius: inset ? radius.lg - 1 : 0, borderTopRightRadius: inset ? radius.lg - 1 : 0 }]}>{cells(layout.lines.map(() => 50), 0)}</View>
      {Array.from({ length: count }, (_, row) => (
        <View key={row} style={[line, HAIRLINE]}>
          {cells(layout.lines, row)}
        </View>
      ))}
    </>
  );
}

/**
 * A list's outline while its first page loads, in the shape of the items it stands for (`SKELETON_LAYOUTS`, shared with
 * the web), always in one column. `frame` follows the list's own where it differs from the shape's (`flush` inside a card
 * that is already white, `band` for full-width rows); `label` replaces "Loading" where the screen already says something
 * more specific.
 */
export function ListSkeleton({ shape, count, label, frame, style }: { shape: SkeletonShape; count?: number; label?: string; frame?: PhoneSkeletonFrame; style?: StyleProp<ViewStyle> }) {
  const layout = SKELETON_LAYOUTS[shape];
  const n = count ?? layout.count;
  const f = frame ?? layout.frame;
  const rows = Array.from({ length: n }, (_, row) => row);
  return (
    <SkeletonGroup label={label} style={style}>
      {layout.table ? (
        <View style={f === "flush" ? undefined : SURFACE}>
          <TableRows layout={layout} count={n} inset={f !== "flush"} />
        </View>
      ) : f === "cards" ? (
        <View style={{ gap: spacing.md }}>
          {rows.map((row) => (
            <View key={row} style={[SURFACE, { padding: spacing.lg }]}>
              <Item layout={layout} row={row} />
            </View>
          ))}
        </View>
      ) : f === "band" ? (
        <View>
          {rows.map((row) => (
            <View key={row} style={BAND_ROW}>
              <Item layout={layout} row={row} />
            </View>
          ))}
        </View>
      ) : (
        <View style={f === "rows" ? SURFACE : undefined}>
          {rows.map((row) => (
            <View key={row} style={[{ paddingVertical: spacing.md, paddingHorizontal: f === "rows" ? spacing.lg : 0 }, row > 0 ? HAIRLINE : null]}>
              <Item layout={layout} row={row} />
            </View>
          ))}
        </View>
      )}
    </SkeletonGroup>
  );
}
