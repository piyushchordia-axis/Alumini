import { useLayoutEffect, useRef, useState, type RefObject } from "react";

// The palette, ticks, number and week text and the marks' places are shared with the phone app, so both draw alike.
export {
  CHART_EMPTY_TEXT,
  columnLayout,
  columnReadoutRows,
  formatCount,
  formatWeek,
  INK,
  lineLayout,
  lineReadoutRows,
  nearestIndex,
  plural,
  SERIES,
  stepIndex,
  tableCellText,
  tooltipLeft,
  unitFor,
  type ChartTableData,
  type LegendItem,
  type ReadoutRow,
  type Unit,
} from "@illuminize/shared";

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
