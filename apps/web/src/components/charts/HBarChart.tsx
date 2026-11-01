import type { CountRow } from "@illuminize/shared";
import { useState } from "react";
import { ChartTooltip } from "./ChartTooltip";
import { formatCount, SERIES, useElementWidth, unitFor, type Unit } from "./chartUtils";

/**
 * Ranked horizontal bars with the value at each tip (so no axis is needed). Labels that don't fit are truncated in
 * the row and shown in full in the hover readout and the table view.
 */
export function HBarChart({
  rows,
  format = formatCount,
  max,
  unit,
  ariaLabel,
  color = SERIES[0],
}: {
  rows: CountRow[];
  format?: (n: number) => string;
  /** Scale end (e.g. the member total for coverage percentages); defaults to the largest value. */
  max?: number;
  unit: Unit;
  ariaLabel: string;
  color?: string;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [active, setActive] = useState<{ i: number; y: number } | null>(null);
  const scale = Math.max(1, max ?? Math.max(0, ...rows.map((r) => r.count)));
  return (
    <div ref={ref} className="relative" role="img" aria-label={ariaLabel}>
      <ul className="space-y-1.5" onPointerLeave={() => setActive(null)}>
        {rows.map((r, i) => (
          <li key={`${r.label}-${i}`} className="grid grid-cols-[minmax(5rem,9rem)_1fr] items-center gap-2 text-xs" onPointerEnter={(e) => setActive({ i, y: (e.currentTarget as HTMLElement).offsetTop })}>
            <span className="truncate text-slate-600">{r.label}</span>
            <span className="flex min-w-0 items-center gap-1.5">
              <span
                aria-hidden
                className="block h-3.5 shrink-0 rounded-r"
                style={{ width: `calc((100% - 3.5rem) * ${r.count / scale})`, minWidth: r.count > 0 ? 2 : 0, background: color, opacity: active === null || active.i === i ? 1 : 0.55 }}
              />
              <span className="shrink-0 tabular-nums font-medium text-slate-700">{format(r.count)}</span>
            </span>
          </li>
        ))}
      </ul>
      {active !== null && rows[active.i] && <ChartTooltip x={width / 2} y={active.y - 52} width={width} title={rows[active.i]!.label} rows={[{ value: format(rows[active.i]!.count), label: unitFor(unit, rows[active.i]!.count) }]} />}
    </div>
  );
}
