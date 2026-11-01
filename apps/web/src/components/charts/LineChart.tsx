import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { ChartTooltip } from "./ChartTooltip";
import { edgeAnchor, formatCount, INK, niceTicks, spreadLabels, tickFormatter, useElementWidth } from "./chartUtils";

export interface LineSeries {
  name: string;
  values: number[];
  color: string;
}

/**
 * Lines over ordered categories (weeks). A crosshair snaps to the nearest week and the readout lists every series
 * there; arrow keys move it when the chart has focus. Each line ends in a direct label (name and latest value), and a
 * single series gets a 10% area wash.
 */
export function LineChart({
  labels,
  series,
  formatLabel = (l) => l,
  describe,
  ariaLabel,
  height = 220,
}: {
  labels: string[];
  series: LineSeries[];
  formatLabel?: (label: string) => string;
  describe?: (label: string) => string;
  ariaLabel: string;
  height?: number;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const n = labels.length;
  const single = series.length === 1;
  const max = Math.max(0, ...series.flatMap((s) => s.values));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1]!;
  const fmt = tickFormatter(top);
  const endLabel = (s: LineSeries) => (single ? formatCount(s.values[n - 1] ?? 0) : `${s.name} ${formatCount(s.values[n - 1] ?? 0)}`);
  const right = Math.min(120, Math.max(...series.map((s) => endLabel(s).length * 6.5)) + 14);
  const m = { top: 12, right, bottom: 22, left: Math.max(24, fmt(top).length * 7 + 10) };
  const innerW = Math.max(0, width - m.left - m.right);
  const innerH = height - m.top - m.bottom;
  const x = (i: number) => m.left + (n > 1 ? (i / (n - 1)) * innerW : innerW / 2);
  const y = (v: number) => m.top + innerH - (v / top) * innerH;
  const every = Math.max(1, Math.ceil((n * 48) / Math.max(1, innerW)));
  const path = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join("");
  const labelYs = spreadLabels(
    series.map((s) => y(s.values[n - 1] ?? 0)),
    13,
    m.top + 4,
    m.top + innerH,
  );

  const indexAt = (e: PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return n > 1 ? Math.max(0, Math.min(n - 1, Math.round(((e.clientX - box.left) / box.width) * (n - 1)))) : 0;
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
        <svg width={width} height={height} role="img" aria-label={ariaLabel} tabIndex={0} onKeyDown={onKey} onFocus={() => setActive((a) => a ?? n - 1)} onBlur={() => setActive(null)} className="block rounded outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={m.left} x2={m.left + innerW} y1={y(t)} y2={y(t)} stroke={t === 0 ? INK.baseline : INK.grid} strokeWidth={1} shapeRendering="crispEdges" />
              <text x={m.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={INK.muted}>
                {fmt(t)}
              </text>
            </g>
          ))}
          {labels.map((l, i) =>
            i % every === (n - 1) % every ? (
              <text key={l} x={edgeAnchor(x(i), width).x} y={height - 6} textAnchor={edgeAnchor(x(i), width).anchor} fontSize={11} fill={INK.muted}>
                {formatLabel(l)}
              </text>
            ) : null,
          )}
          {single && series[0] && <path d={`${path(series[0].values)}L${x(n - 1)},${y(0)}L${x(0)},${y(0)}Z`} fill={series[0].color} fillOpacity={0.1} />}
          {series.map((s) => (
            <path key={s.name} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {series.map((s, k) => (
            <g key={s.name}>
              <circle cx={x(n - 1)} cy={y(s.values[n - 1] ?? 0)} r={4} fill={s.color} stroke={INK.surface} strokeWidth={2} />
              <text x={x(n - 1) + 8} y={labelYs[k]} dy="0.32em" fontSize={11} fill={INK.secondary}>
                {endLabel(s)}
              </text>
            </g>
          ))}
          {active !== null && (
            <g pointerEvents="none">
              <line x1={x(active)} x2={x(active)} y1={m.top} y2={m.top + innerH} stroke={INK.baseline} strokeWidth={1} />
              {series.map((s) => (
                <circle key={s.name} cx={x(active)} cy={y(s.values[active] ?? 0)} r={4} fill={s.color} stroke={INK.surface} strokeWidth={2} />
              ))}
            </g>
          )}
          <rect x={m.left} y={m.top} width={innerW} height={innerH} fill="transparent" onPointerMove={(e) => setActive(indexAt(e))} onPointerLeave={() => setActive(null)} />
        </svg>
      )}
      {active !== null && labels[active] !== undefined && (
        <ChartTooltip
          x={x(active)}
          y={m.top}
          width={width}
          beside
          title={(describe ?? formatLabel)(labels[active]!)}
          rows={series.map((s) => ({ value: formatCount(s.values[active] ?? 0), label: s.name, color: series.length > 1 ? s.color : undefined }))}
        />
      )}
    </div>
  );
}
