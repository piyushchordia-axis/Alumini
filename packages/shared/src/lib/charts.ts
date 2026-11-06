import { formatCalendarDate, formatCount } from "./admin";

/**
 * Chart geometry and text, shared so that both apps draw the same marks in the same places. Numbers and dates are
 * written by hand rather than through Intl, which Hermes may lack parts of.
 */

/**
 * Categorical series colours, in this fixed order (never cycled, never the institution's brand). Validated for
 * colour-blind separation on the white card surface; slots 3 and 4 are below 3:1 contrast, so charts using them carry
 * direct labels and a table view.
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

/** What a chart card says when its period has nothing to draw. */
export const CHART_EMPTY_TEXT = "Nothing to show for this period yet.";

/** A key in a chart's legend, drawn like its mark: a short line for a line chart, a block for bars. */
export interface LegendItem {
  label: string;
  color: string;
  kind: "line" | "rect";
}

/** Every value of a chart as a table, the first column naming the row. */
export interface ChartTableData {
  columns: string[];
  rows: Array<Array<string | number>>;
}

/** A table cell's text: figures grouped by thousands. */
export function tableCellText(cell: string | number): string {
  return typeof cell === "number" ? formatCount(cell) : cell;
}

/** A unit that agrees with its count: "members" or (n) => (n === 1 ? "member" : "members"). */
export type Unit = string | ((n: number) => string);
export const unitFor = (unit: Unit, n: number): string => (typeof unit === "function" ? unit(n) : unit);
export const plural = (one: string, other: string): Unit => (n) => (n === 1 ? one : other);

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

const COMPACT_SUFFIXES = ["", "K", "M", "B", "T"] as const;

/** A count in short form, to one decimal: 950, "10K", "12.3K", "1.2M". 999,950 rounds up to "1M", not "1000K". */
export function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  let scaled = Math.abs(n);
  let unit = 0;
  while (unit < COMPACT_SUFFIXES.length - 1 && Math.round(scaled * 10) / 10 >= 1000) {
    scaled /= 1000;
    unit++;
  }
  if (unit === 0) return formatCount(n);
  const rounded = Math.round(scaled * 10) / 10;
  return `${n < 0 ? "-" : ""}${rounded}${COMPACT_SUFFIXES[unit]}`;
}

/** Axis numbers: in full under 10,000, compact (10K) on an axis that reaches it. */
export function tickFormatter(axisMax: number): (n: number) => string {
  return axisMax >= 10_000 ? formatCompact : formatCount;
}

/**
 * A week's Monday, "2026-11-02", as "2 Nov", or "2 Nov 2026" with its year: read from the text, so it never shifts a
 * day in a zone west of UTC.
 */
export function formatWeek(day: string, withYear = false): string {
  const text = formatCalendarDate(day);
  return withYear || text === day ? text : text.slice(0, text.lastIndexOf(" "));
}

/** The title of one week's readout: "Week of 2 Nov 2026". */
export const weekTitle = (day: string): string => `Week of ${formatWeek(day, true)}`;

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

export type TextAnchor = "start" | "middle" | "end";

/** Keeps an axis label inside the chart: centred under its mark, or pinned to the edge it would cross. */
export function edgeAnchor(x: number, width: number, half = 22): { x: number; anchor: TextAnchor } {
  if (x - half < 0) return { x: Math.max(0, x - 6), anchor: "start" };
  if (x + half > width) return { x: Math.min(width, x + 6), anchor: "end" };
  return { x, anchor: "middle" };
}

export interface ChartMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** A gridline and its number on the y axis. */
export interface ChartTick {
  value: number;
  y: number;
  text: string;
}

/** A category's label under the plot. Only every few are drawn when they wouldn't fit, the last one always. */
export interface AxisLabel {
  index: number;
  x: number;
  anchor: TextAnchor;
}

interface PlotLayout {
  n: number;
  width: number;
  height: number;
  m: ChartMargins;
  innerW: number;
  innerH: number;
  ticks: ChartTick[];
  /** The y of a value; 0 sits on the baseline. */
  y: (v: number) => number;
  /** The y of the baseline. */
  baseline: number;
  axisLabels: AxisLabel[];
  /** Where an axis label sits, below the plot (text baseline). */
  axisLabelY: number;
}

export interface ColumnLayout extends PlotLayout {
  kind: "column";
  /** Each category's share of the plot's width, and the column drawn in it. */
  band: number;
  barW: number;
  xCenter: (i: number) => number;
  /** The column for the value at `i`, as a path ("" for nothing to draw). */
  bar: (i: number) => string;
  /** The tallest column, which carries its value on its cap (none when every value is 0). */
  peak: { index: number; x: number; y: number; text: string } | null;
}

export interface LineEnd {
  /** The last point's place, which gets a dot. */
  x: number;
  y: number;
  /** The direct label's place beside it, spread so that none overlap. */
  labelX: number;
  labelY: number;
  text: string;
}

export interface LineLayout extends PlotLayout {
  kind: "line";
  x: (i: number) => number;
  /** A series' line, as a path. */
  path: (values: readonly number[]) => string;
  /** A single series' 10% area wash, as a path (null with several series, which would hide each other). */
  area: string | null;
  ends: LineEnd[];
}

export type ChartLayout = ColumnLayout | LineLayout;

const AXIS_LABEL_SPACE = 48;
/** An axis number's width, roughly: 7px a character at 11px. */
const leftMargin = (tickText: string) => Math.max(24, tickText.length * 7 + 10);

function plot(n: number, max: number, width: number, height: number, margins: Omit<ChartMargins, "left">, xAt: (i: number, m: ChartMargins, innerW: number) => number): PlotLayout {
  const values = niceTicks(max);
  const top = values[values.length - 1]!;
  const fmt = tickFormatter(top);
  const m = { ...margins, left: leftMargin(fmt(top)) };
  const innerW = Math.max(0, width - m.left - m.right);
  const innerH = height - m.top - m.bottom;
  const y = (v: number) => m.top + innerH - (v / top) * innerH;
  const every = Math.max(1, Math.ceil((n * AXIS_LABEL_SPACE) / Math.max(1, innerW)));
  const axisLabels: AxisLabel[] = [];
  for (let i = 0; i < n; i++) {
    if (i % every !== (n - 1) % every) continue;
    const at = edgeAnchor(xAt(i, m, innerW), width);
    axisLabels.push({ index: i, x: at.x, anchor: at.anchor });
  }
  return { n, width, height, m, innerW, innerH, ticks: values.map((v) => ({ value: v, y: y(v), text: fmt(v) })), y, baseline: y(0), axisLabels, axisLabelY: height - 6 };
}

/** Where one series of columns goes in a chart `width` by `height`. */
export function columnLayout({ values, width, height }: { values: readonly number[]; width: number; height: number }): ColumnLayout {
  const n = values.length;
  const max = Math.max(0, ...values);
  const band = (innerW: number) => (n ? innerW / n : 0);
  const p = plot(n, max, width, height, { top: 18, right: 8, bottom: 22 }, (i, m, innerW) => m.left + band(innerW) * i + band(innerW) / 2);
  const b = band(p.innerW);
  const barW = Math.max(2, Math.min(24, b - 2));
  const xCenter = (i: number) => p.m.left + b * i + b / 2;
  const peakIndex = values.indexOf(max);
  return {
    ...p,
    kind: "column",
    band: b,
    barW,
    xCenter,
    bar: (i) => columnPath(xCenter(i) - barW / 2, p.y(values[i] ?? 0), barW, p.baseline),
    peak: max > 0 ? { index: peakIndex, x: xCenter(peakIndex), y: p.y(max) - 5, text: formatCount(max) } : null,
  };
}

/** A line's direct label: its latest value, after its name when there are several. */
const endText = (series: readonly LineInput[], s: LineInput, n: number) => {
  const last = formatCount(s.values[n - 1] ?? 0);
  return series.length === 1 ? last : `${s.name} ${last}`;
};

export interface LineInput {
  name: string;
  values: readonly number[];
}

/** Where lines over `n` ordered categories go in a chart `width` by `height`, with room on the right for their labels. */
export function lineLayout({ series, n, width, height }: { series: readonly LineInput[]; n: number; width: number; height: number }): LineLayout {
  const max = Math.max(0, ...series.flatMap((s) => s.values));
  const texts = series.map((s) => endText(series, s, n));
  // 6.5px a character at 11px, and never more than 120px, so a long name can't squeeze the plot away.
  const right = Math.min(120, Math.max(0, ...texts.map((t) => t.length * 6.5)) + 14);
  const xAt = (i: number, m: ChartMargins, innerW: number) => m.left + (n > 1 ? (i / (n - 1)) * innerW : innerW / 2);
  const p = plot(n, max, width, height, { top: 12, right, bottom: 22 }, xAt);
  const x = (i: number) => xAt(i, p.m, p.innerW);
  const path = (values: readonly number[]) => values.map((v, i) => `${i ? "L" : "M"}${x(i)},${p.y(v)}`).join("");
  const lastYs = series.map((s) => p.y(s.values[n - 1] ?? 0));
  const labelYs = spreadLabels(lastYs, 13, p.m.top + 4, p.m.top + p.innerH);
  const single = series.length === 1 ? series[0]! : null;
  return {
    ...p,
    kind: "line",
    x,
    path,
    area: single && n > 0 ? `${path(single.values)}L${x(n - 1)},${p.baseline}L${x(0)},${p.baseline}Z` : null,
    ends: texts.map((text, k) => ({ x: x(n - 1), y: lastYs[k]!, labelX: x(n - 1) + 8, labelY: labelYs[k]!, text })),
  };
}

/**
 * The category under `x` (from the chart's left edge): the column whose band holds it, or the nearest point on a line.
 * Anything past either end takes the end's.
 */
export function nearestIndex(x: number, layout: Pick<ChartLayout, "kind" | "n" | "m" | "innerW">): number {
  const { n, m, innerW } = layout;
  if (n <= 1 || innerW <= 0) return 0;
  const at = (x - m.left) / innerW;
  const i = layout.kind === "column" ? Math.floor(at * n) : Math.round(at * (n - 1));
  return Math.max(0, Math.min(n - 1, i));
}

/**
 * The category after (step 1) or before (step -1) the active one, kept within the chart. With none active yet, it starts
 * from the first going forward and from the last going back.
 */
export function stepIndex(active: number | null, n: number, step: 1 | -1): number {
  if (n <= 0) return 0;
  const from = active ?? (step === 1 ? -1 : n);
  return Math.max(0, Math.min(n - 1, from + step));
}

/**
 * Where a readout box `boxWidth` wide goes in a chart `width` wide: centred over the mark at `x`, or `beside` a
 * crosshair (so it never hides the week it describes); always inside the chart.
 */
export function tooltipLeft(x: number, width: number, boxWidth: number, beside = false): number {
  const want = beside ? (x + 12 + boxWidth <= width ? x + 12 : x - 12 - boxWidth) : x - boxWidth / 2;
  return Math.max(0, Math.min(want, width - boxWidth));
}

/** One line of a readout: the value leads, then what it counts. */
export interface ReadoutRow {
  value: string;
  label: string;
  /** The series' colour, for a key beside the row (never the text's colour). */
  color?: string;
}

/** A column's readout: "3 approved". */
export function columnReadoutRows(value: number, unit: Unit): ReadoutRow[] {
  return [{ value: formatCount(value), label: unitFor(unit, value) }];
}

/** The lines' readout at one category, every series in order; colour keys only when there are several to tell apart. */
export function lineReadoutRows(series: ReadonlyArray<LineInput & { color: string }>, index: number): ReadoutRow[] {
  return series.map((s) => ({ value: formatCount(s.values[index] ?? 0), label: s.name, color: series.length > 1 ? s.color : undefined }));
}

/**
 * A readout in one line of text, as a screen reader reads the value of an adjustable chart: "Week of 2 Nov 2026, 3
 * approved", or "Week of 2 Nov 2026, Posts 4, Comments 9" with several series.
 */
export function readoutText(title: string, rows: readonly ReadoutRow[], several = rows.length > 1): string {
  return [title, ...rows.map((r) => (several ? `${r.label} ${r.value}` : `${r.value} ${r.label}`))].join(", ");
}
