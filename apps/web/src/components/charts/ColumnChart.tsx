import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { ChartTooltip } from "./ChartTooltip";
import { columnPath, edgeAnchor, formatCount, INK, niceTicks, SERIES, tickFormatter, useElementWidth, unitFor, type Unit } from "./chartUtils";

/**
 * One series of columns over ordered categories (weeks, batch years). The whole band under the pointer is the hit
 * target; arrow keys step through columns when the chart has focus. The tallest column carries its value on the cap.
 */
export function ColumnChart({
  labels,
  values,
  formatLabel = (l) => l,
  describe,
  unit,
  ariaLabel,
  height = 200,
  color = SERIES[0],
}: {
  labels: string[];
  values: number[];
  formatLabel?: (label: string) => string;
  /** Tooltip title for a category (defaults to the axis label). */
  describe?: (label: string) => string;
  unit: Unit;
  ariaLabel: string;
  height?: number;
  color?: string;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const n = values.length;
  const max = Math.max(0, ...values);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1]!;
  const fmt = tickFormatter(top);
  const left = Math.max(24, fmt(top).length * 7 + 10);
  const m = { top: 18, right: 8, bottom: 22, left };
  const innerW = Math.max(0, width - m.left - m.right);
  const innerH = height - m.top - m.bottom;
  const band = n ? innerW / n : 0;
  const barW = Math.max(2, Math.min(24, band - 2));
  const y = (v: number) => m.top + innerH - (v / top) * innerH;
  const xCenter = (i: number) => m.left + band * i + band / 2;
  const every = Math.max(1, Math.ceil((n * 48) / Math.max(1, innerW)));
  const peak = values.indexOf(max);

  const indexAt = (e: PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - box.left) / box.width) * n)));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      setActive((a) => Math.max(0, Math.min(n - 1, (a ?? (e.key === "ArrowRight" ? -1 : n)) + (e.key === "ArrowRight" ? 1 : -1))));
    } else if (e.key === "Escape") setActive(null);
  };

  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel} tabIndex={0} onKeyDown={onKey} onFocus={() => setActive((a) => a ?? n - 1)} onBlur={() => setActive(null)} className="block outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? INK.baseline : INK.grid} strokeWidth={1} shapeRendering="crispEdges" />
              <text x={m.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={INK.muted}>
                {fmt(t)}
              </text>
            </g>
          ))}
          {values.map((v, i) => (
            <path key={i} d={columnPath(xCenter(i) - barW / 2, y(v), barW, y(0))} fill={color} fillOpacity={active === null || active === i ? 1 : 0.55} />
          ))}
          {max > 0 && (
            <text x={xCenter(peak)} y={y(max) - 5} textAnchor="middle" fontSize={11} fontWeight={600} fill={INK.secondary}>
              {formatCount(max)}
            </text>
          )}
          {labels.map((l, i) =>
            i % every === (n - 1) % every ? (
              <text key={l} x={edgeAnchor(xCenter(i), width).x} y={height - 6} textAnchor={edgeAnchor(xCenter(i), width).anchor} fontSize={11} fill={INK.muted}>
                {formatLabel(l)}
              </text>
            ) : null,
          )}
          <rect x={m.left} y={m.top} width={innerW} height={innerH} fill="transparent" onPointerMove={(e) => setActive(indexAt(e))} onPointerLeave={() => setActive(null)} />
        </svg>
      )}
      {active !== null && labels[active] !== undefined && (
        <ChartTooltip x={xCenter(active)} y={Math.max(0, y(values[active] ?? 0) - 64)} width={width} title={(describe ?? formatLabel)(labels[active]!)} rows={[{ value: formatCount(values[active] ?? 0), label: unitFor(unit, values[active] ?? 0) }]} />
      )}
    </div>
  );
}
