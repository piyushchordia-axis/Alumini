import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { ChartTooltip } from "./ChartTooltip";
import { INK, lineLayout, lineReadoutRows, nearestIndex, stepIndex, useElementWidth } from "./chartUtils";

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
  titles = labels,
  series,
  ariaLabel,
  height = 220,
}: {
  /** Each category's axis label. */
  labels: string[];
  /** Each category's readout title (defaults to its axis label). */
  titles?: string[];
  series: LineSeries[];
  ariaLabel: string;
  height?: number;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const layout = lineLayout({ series, n: labels.length, width, height });
  const { m, n, x, y } = layout;

  const indexAt = (e: PointerEvent<SVGRectElement>) => nearestIndex(m.left + e.clientX - e.currentTarget.getBoundingClientRect().left, layout);
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      setActive((a) => stepIndex(a, n, e.key === "ArrowRight" ? 1 : -1));
    } else if (e.key === "Escape") setActive(null);
  };

  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel} tabIndex={0} onKeyDown={onKey} onFocus={() => setActive((a) => a ?? n - 1)} onBlur={() => setActive(null)} className="block rounded outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
          {layout.ticks.map((t) => (
            <g key={t.value}>
              <line x1={m.left} x2={m.left + layout.innerW} y1={t.y} y2={t.y} stroke={t.value === 0 ? INK.baseline : INK.grid} strokeWidth={1} shapeRendering="crispEdges" />
              <text x={m.left - 6} y={t.y} dy="0.32em" textAnchor="end" fontSize={11} fill={INK.muted}>
                {t.text}
              </text>
            </g>
          ))}
          {layout.axisLabels.map((l) => (
            <text key={l.index} x={l.x} y={layout.axisLabelY} textAnchor={l.anchor} fontSize={11} fill={INK.muted}>
              {labels[l.index]}
            </text>
          ))}
          {layout.area && series[0] && <path d={layout.area} fill={series[0].color} fillOpacity={0.1} />}
          {series.map((s) => (
            <path key={s.name} d={layout.path(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {series.map((s, k) => {
            const end = layout.ends[k]!;
            return (
              <g key={s.name}>
                <circle cx={end.x} cy={end.y} r={4} fill={s.color} stroke={INK.surface} strokeWidth={2} />
                <text x={end.labelX} y={end.labelY} dy="0.32em" fontSize={11} fill={INK.secondary}>
                  {end.text}
                </text>
              </g>
            );
          })}
          {active !== null && (
            <g pointerEvents="none">
              <line x1={x(active)} x2={x(active)} y1={m.top} y2={m.top + layout.innerH} stroke={INK.baseline} strokeWidth={1} />
              {series.map((s) => (
                <circle key={s.name} cx={x(active)} cy={y(s.values[active] ?? 0)} r={4} fill={s.color} stroke={INK.surface} strokeWidth={2} />
              ))}
            </g>
          )}
          <rect x={m.left} y={m.top} width={layout.innerW} height={layout.innerH} fill="transparent" onPointerMove={(e) => setActive(indexAt(e))} onPointerLeave={() => setActive(null)} />
        </svg>
      )}
      {active !== null && titles[active] !== undefined && <ChartTooltip x={x(active)} y={m.top} width={width} beside title={titles[active]} rows={lineReadoutRows(series, active)} />}
    </div>
  );
}
