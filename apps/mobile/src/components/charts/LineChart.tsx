import { INK, lineLayout, lineReadoutRows, readoutText, type ChartSeries } from "@illuminize/shared";
import { useState } from "react";
import { View } from "react-native";
import { Circle, G, Line, Path, Svg, Text as SvgText } from "react-native-svg";
import { spacing } from "@/theme";
import { CHART_FONT, ChartPlot, useChosen } from "./ChartPlot";
import { ChartReadout } from "./ChartReadout";

/** Where 11-point text sits on a y: a third of its height below it, as dy="0.32em" does on the web. */
const MIDDLE = 3.5;

/**
 * Lines over ordered categories (weeks), placed by the shared layout as on the web. Each line ends in a direct label (its
 * name and latest value), and a single series gets a 10% area wash. The readout above lists every series at the chosen
 * week, the latest until a finger or a screen reader picks another, which then gets a crosshair and dots.
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
  /** Each category's readout title (its axis label when not given). */
  titles?: string[];
  series: ChartSeries[];
  ariaLabel: string;
  height?: number;
}) {
  const [width, setWidth] = useState(0);
  const [active, choose] = useChosen(titles);
  const layout = lineLayout({ series, n: labels.length, width, height });
  const { m, n, x, y } = layout;
  const shown = active ?? n - 1;
  const title = titles[shown];
  const rows = lineReadoutRows(series, shown);
  return (
    <View style={{ gap: spacing.xs }}>
      {title !== undefined && <ChartReadout title={title} rows={rows} />}
      <ChartPlot layout={layout} height={height} active={active} onActive={choose} label={ariaLabel} valueText={title !== undefined ? readoutText(title, rows) : undefined} onWidth={setWidth}>
        {width > 0 && (
          <Svg width={width} height={height}>
            {layout.ticks.map((t) => (
              <G key={t.value}>
                <Line x1={m.left} x2={m.left + layout.innerW} y1={t.y} y2={t.y} stroke={t.value === 0 ? INK.baseline : INK.grid} strokeWidth={1} />
                <SvgText fontFamily={CHART_FONT} x={m.left - 6} y={t.y + MIDDLE} textAnchor="end" fontSize={11} fill={INK.muted}>
                  {t.text}
                </SvgText>
              </G>
            ))}
            {layout.axisLabels.map((l) => (
              <SvgText key={l.index} fontFamily={CHART_FONT} x={l.x} y={layout.axisLabelY} textAnchor={l.anchor} fontSize={11} fill={INK.muted}>
                {labels[l.index] ?? ""}
              </SvgText>
            ))}
            {layout.area && series[0] && <Path d={layout.area} fill={series[0].color} fillOpacity={0.1} />}
            {series.map((s) => (
              <Path key={s.name} d={layout.path(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {series.map((s, k) => {
              const end = layout.ends[k];
              if (!end) return null;
              return (
                <G key={s.name}>
                  <Circle cx={end.x} cy={end.y} r={4} fill={s.color} stroke={INK.surface} strokeWidth={2} />
                  <SvgText fontFamily={CHART_FONT} x={end.labelX} y={end.labelY + MIDDLE} fontSize={11} fill={INK.secondary}>
                    {end.text}
                  </SvgText>
                </G>
              );
            })}
            {active !== null && (
              <G>
                <Line x1={x(active)} x2={x(active)} y1={m.top} y2={m.top + layout.innerH} stroke={INK.baseline} strokeWidth={1} />
                {series.map((s) => (
                  <Circle key={s.name} cx={x(active)} cy={y(s.values[active] ?? 0)} r={4} fill={s.color} stroke={INK.surface} strokeWidth={2} />
                ))}
              </G>
            )}
          </Svg>
        )}
      </ChartPlot>
    </View>
  );
}
