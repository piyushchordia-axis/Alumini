import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { ChartTooltip } from "./ChartTooltip";
import { columnLayout, columnReadoutRows, INK, nearestIndex, SERIES, stepIndex, useElementWidth, type Unit } from "./chartUtils";

/**
 * One series of columns over ordered categories (weeks, batch years). The whole band under the pointer is the hit
 * target; arrow keys step through columns when the chart has focus. The tallest column carries its value on the cap.
 */
export function ColumnChart({
  labels,
  titles = labels,
  values,
  unit,
  ariaLabel,
  height = 200,
  color = SERIES[0],
}: {
  /** Each category's axis label. */
  labels: string[];
  /** Each category's readout title (defaults to its axis label). */
  titles?: string[];
  values: number[];
  unit: Unit;
  ariaLabel: string;
  height?: number;
  color?: string;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const layout = columnLayout({ values, width, height });
  const { m, n } = layout;

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
        <svg width={width} height={height} role="img" aria-label={ariaLabel} tabIndex={0} onKeyDown={onKey} onFocus={() => setActive((a) => a ?? n - 1)} onBlur={() => setActive(null)} className="block outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded">
          {layout.ticks.map((t) => (
            <g key={t.value}>
              <line x1={m.left} x2={width - m.right} y1={t.y} y2={t.y} stroke={t.value === 0 ? INK.baseline : INK.grid} strokeWidth={1} shapeRendering="crispEdges" />
              <text x={m.left - 6} y={t.y} dy="0.32em" textAnchor="end" fontSize={11} fill={INK.muted}>
                {t.text}
              </text>
            </g>
          ))}
          {values.map((_, i) => (
            <path key={i} d={layout.bar(i)} fill={color} fillOpacity={active === null || active === i ? 1 : 0.55} />
          ))}
          {layout.peak && (
            <text x={layout.peak.x} y={layout.peak.y} textAnchor="middle" fontSize={11} fontWeight={600} fill={INK.secondary}>
              {layout.peak.text}
            </text>
          )}
          {layout.axisLabels.map((l) => (
            <text key={l.index} x={l.x} y={layout.axisLabelY} textAnchor={l.anchor} fontSize={11} fill={INK.muted}>
              {labels[l.index]}
            </text>
          ))}
          <rect x={m.left} y={m.top} width={layout.innerW} height={layout.innerH} fill="transparent" onPointerMove={(e) => setActive(indexAt(e))} onPointerLeave={() => setActive(null)} />
        </svg>
      )}
      {active !== null && titles[active] !== undefined && (
        <ChartTooltip x={layout.xCenter(active)} y={Math.max(0, layout.y(values[active] ?? 0) - 64)} width={width} title={titles[active]} rows={columnReadoutRows(values[active] ?? 0, unit)} />
      )}
    </div>
  );
}
