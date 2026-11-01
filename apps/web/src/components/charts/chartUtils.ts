import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/**
 * Categorical series colours, in this fixed order (never cycled). Validated for colour-blind separation on the white
 * card surface; slots 3 and 4 are below 3:1 contrast, so charts using them carry direct labels and a table view.
 */
export const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"] as const;

/** Text and chrome tokens (the app's slate scale). Text never wears a series colour. */
export const INK = {
  primary: "#0f172a",
  secondary: "#475569",
  muted: "#64748b",
  grid: "#e2e8f0",
  baseline: "#cbd5e1",
  surface: "#ffffff",
} as const;

/** Clean, whole-number axis ticks from 0 to just above `max`. */
export function niceTicks(max: number, target = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag);
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  return ticks;
}

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const full = new Intl.NumberFormat();

/** Axis numbers: in full under 10,000, compact (10K) on an axis that reaches it. */
export function tickFormatter(axisMax: number): (n: number) => string {
  return axisMax >= 10_000 ? (n) => compact.format(n) : (n) => full.format(n);
}

export const formatCount = (n: number) => full.format(n);

/** "2026-11-02" → "2 Nov" (calendar dates are formatted in UTC so they never shift a day). */
export function formatWeek(day: string, withYear = false): string {
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
}

/** Width of an element, kept up to date as it resizes (charts redraw to fit). */
export function useElementWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setWidth(Math.floor(entries[0]?.contentRect.width ?? 0)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** A column with a 4px rounded data end and a square foot on the baseline. */
export function columnPath(x: number, y: number, w: number, baseline: number): string {
  const h = baseline - y;
  if (h <= 0) return "";
  const r = Math.min(4, w / 2, h);
  return `M${x},${baseline}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${baseline}Z`;
}

/** Pushes labels apart vertically so none overlap (positions sorted top to bottom, `gap` px apart at least). */
export function spreadLabels(ys: number[], gap: number, min: number, max: number): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  for (let k = 0; k < order.length; k++) {
    const prev = order[k - 1];
    order[k]!.y = Math.max(order[k]!.y, min, prev ? prev.y + gap : min);
  }
  for (let k = order.length - 1; k >= 0; k--) {
    const next = order[k + 1];
    order[k]!.y = Math.min(order[k]!.y, next ? next.y - gap : max);
  }
  const out = new Array<number>(ys.length);
  for (const o of order) out[o.i] = o.y;
  return out;
}

/** Keeps an axis label inside the chart: centred under its mark, or pinned to the edge it would cross. */
export function edgeAnchor(x: number, width: number, half = 22): { x: number; anchor: "start" | "middle" | "end" } {
  if (x - half < 0) return { x: Math.max(0, x - 6), anchor: "start" };
  if (x + half > width) return { x: Math.min(width, x + 6), anchor: "end" };
  return { x, anchor: "middle" };
}

/** A unit that agrees with its count: "members" or (n) => (n === 1 ? "member" : "members"). */
export type Unit = string | ((n: number) => string);
export const unitFor = (unit: Unit, n: number) => (typeof unit === "function" ? unit(n) : unit);
export const plural = (one: string, other: string): Unit => (n) => (n === 1 ? one : other);
