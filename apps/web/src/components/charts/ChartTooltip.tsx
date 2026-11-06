import { tooltipLeft, type ReadoutRow } from "./chartUtils";

const BOX_WIDTH = 176;

/**
 * Hover/focus readout, positioned inside the chart's relative container. Values lead (strong), labels follow. Content
 * is rendered as React text, so names from the API are never parsed as HTML.
 */
export function ChartTooltip({ x, y, width, title, rows, beside }: { x: number; y: number; width: number; title: string; rows: ReadoutRow[]; beside?: boolean }) {
  return (
    <div role="status" className="pointer-events-none absolute z-10 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg" style={{ left: tooltipLeft(x, width, BOX_WIDTH, beside), top: Math.max(0, y), width: BOX_WIDTH }}>
      <div className="mb-1 text-slate-500">{title}</div>
      <ul className="space-y-0.5">
        {rows.map((r, i) => (
          <li key={i} className="flex items-center gap-2">
            {r.color && <span aria-hidden className="inline-block h-0.5 w-3 shrink-0 rounded-full" style={{ background: r.color }} />}
            <strong className="font-semibold text-slate-900">{r.value}</strong>
            <span className="truncate text-slate-600">{r.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
