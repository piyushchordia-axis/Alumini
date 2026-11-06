import { nearestIndex, stepIndex, type ChartLayout } from "@illuminize/shared";
import { useRef, useState, type ReactNode } from "react";
import { Platform, StyleSheet, View, type AccessibilityActionEvent, type GestureResponderEvent, type KeyDownEvent } from "react-native";

const STEPS = [
  { name: "increment", label: "Next" },
  { name: "decrement", label: "Previous" },
] as const;

/**
 * The font of the charts' text: on the web build the app's own (react-native-web's system stack), as SVG text would
 * otherwise fall back to a serif; on a phone, react-native-svg's default, which is already the system's.
 */
export const CHART_FONT = Platform.select({ web: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif', default: undefined });

/**
 * The category a chart has chosen, by its readout title rather than its place: a new period that still holds that week
 * keeps it chosen, and one that doesn't chooses none, where a place would point at another week. None until one is, and
 * none again when given null.
 */
export function useChosen(titles: readonly string[]): [number | null, (index: number | null) => void] {
  const [chosen, setChosen] = useState<string | null>(null);
  const at = chosen === null ? -1 : titles.indexOf(chosen);
  return [at >= 0 ? at : null, (index) => setChosen(index === null ? null : (titles[index] ?? null))];
}

/**
 * A chart's plot, `height` tall and as wide as its card (`onWidth`): the drawing, hidden from screen readers, under a
 * surface that is what both the finger and a screen reader use. A finger on it chooses the category beneath, and dragging
 * sideways scrubs through them; a vertical drag hands over to the page's scrolling, which puts back the choice from
 * before the finger came down, so scrolling past a chart doesn't choose a week in it. The choice stays when the finger
 * lifts. To a screen reader it is one adjustable control, named by the chart's summary, whose value is the chosen
 * category's readout, and swiping up or down (or the arrow keys, on the web build) steps through them. With none chosen
 * yet, it is the last.
 */
export function ChartPlot({
  layout,
  height,
  active,
  onActive,
  label,
  valueText,
  onWidth,
  children,
}: {
  layout: Pick<ChartLayout, "kind" | "n" | "m" | "innerW">;
  height: number;
  active: number | null;
  /** A category chosen, or null for none (the last one shown). */
  onActive: (index: number | null) => void;
  label: string;
  valueText?: string;
  onWidth: (width: number) => void;
  children: ReactNode;
}) {
  const n = layout.n;
  const step = (by: 1 | -1) => onActive(stepIndex(active ?? n - 1, n, by));
  // The surface starts at the chart's left edge, where the layout measures from.
  const choose = (e: GestureResponderEvent) => onActive(nearestIndex(e.nativeEvent.locationX, layout));
  // The choice before the finger came down: a touch can't yet tell a scrub from a scroll, so it chooses at once, and the
  // page taking the touch over to scroll undoes that.
  const before = useRef<number | null>(null);
  const onAction = (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === "increment") step(1);
    else if (e.nativeEvent.actionName === "decrement") step(-1);
  };
  const onKey = (e: KeyDownEvent) => {
    const key = e.nativeEvent.key;
    if (key !== "ArrowRight" && key !== "ArrowLeft") return;
    e.preventDefault();
    step(key === "ArrowRight" ? 1 : -1);
  };
  return (
    <View style={{ height }} onLayout={(e) => onWidth(Math.floor(e.nativeEvent.layout.width))}>
      <View aria-hidden style={StyleSheet.absoluteFill}>
        {children}
      </View>
      <View
        style={StyleSheet.absoluteFill}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        aria-valuetext={valueText}
        accessibilityActions={STEPS}
        onAccessibilityAction={onAction}
        focusable
        onKeyDown={onKey}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(e) => {
          before.current = active;
          choose(e);
        }}
        onResponderMove={choose}
        onResponderTerminationRequest={() => true}
        onResponderTerminate={() => onActive(before.current)}
      />
    </View>
  );
}
