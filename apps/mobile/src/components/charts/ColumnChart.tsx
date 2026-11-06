import { columnLayout, columnReadoutRows, INK, readoutText, SERIES, type Unit } from "@illuminize/shared";
import { useState } from "react";
import { View } from "react-native";
import { Line, Path, Svg, Text as SvgText } from "react-native-svg";
import { spacing } from "@/theme";
import { CHART_FONT, ChartPlot, useChosen } from "./ChartPlot";
import { ChartReadout } from "./ChartReadout";

/** Where 11-point text sits on a gridline's y: a third of its height below it, as dy="0.32em" does on the web. */
const MIDDLE = 3.5;

/**
 * One series of columns over ordered categories (weeks, batch years), placed by the shared layout as on the web. The
 * readout above names the chosen column, the latest until a finger or a screen reader picks another, which then stands
 * out while the rest fade. The tallest column carries its value on its cap.
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
  /** Each category's readout title (its axis label when not given). */
  titles?: string[];
  values: number[];
  unit: Unit;
  ariaLabel: string;
  height?: number;
  color?: string;
}) {
  const [width, setWidth] = useState(0);
  const [active, choose] = useChosen(titles);
  const layout = columnLayout({ values, width, height });
  const { m, n } = layout;
  const shown = active ?? n - 1;
  const title = titles[shown];
  const rows = columnReadoutRows(values[shown] ?? 0, unit);
  return (
    <View style={{ gap: spacing.xs }}>
      {title !== undefined && <ChartReadout title={title} rows={rows} />}
      <ChartPlot layout={layout} height={height} active={active} onActive={choose} label={ariaLabel} valueText={title !== undefined ? readoutText(title, rows) : undefined} onWidth={setWidth}>
        {width > 0 && (
          <Svg width={width} height={height}>
            {layout.ticks.map((t) => (
              <Line key={`line-${t.value}`} x1={m.left} x2={width - m.right} y1={t.y} y2={t.y} stroke={t.value === 0 ? INK.baseline : INK.grid} strokeWidth={1} />
            ))}
            {layout.ticks.map((t) => (
              <SvgText key={`tick-${t.value}`} fontFamily={CHART_FONT} x={m.left - 6} y={t.y + MIDDLE} textAnchor="end" fontSize={11} fill={INK.muted}>
                {t.text}
              </SvgText>
            ))}
            {values.map((_, i) => {
              const d = layout.bar(i);
              return d ? <Path key={i} d={d} fill={color} fillOpacity={active === null || active === i ? 1 : 0.55} /> : null;
            })}
            {layout.peak && (
              <SvgText fontFamily={CHART_FONT} x={layout.peak.x} y={layout.peak.y} textAnchor="middle" fontSize={11} fontWeight="600" fill={INK.secondary}>
                {layout.peak.text}
              </SvgText>
            )}
            {layout.axisLabels.map((l) => (
              <SvgText key={l.index} fontFamily={CHART_FONT} x={l.x} y={layout.axisLabelY} textAnchor={l.anchor} fontSize={11} fill={INK.muted}>
                {labels[l.index] ?? ""}
              </SvgText>
            ))}
          </Svg>
        )}
      </ChartPlot>
    </View>
  );
}
