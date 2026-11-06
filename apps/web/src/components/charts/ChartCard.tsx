import clsx from "clsx";
import { useId, useState, type ReactNode } from "react";
import { Card } from "@/components/ui";
import { CHART_EMPTY_TEXT, tableCellText, type ChartTableData, type LegendItem } from "./chartUtils";

/**
 * Frame for one chart: title, optional subtitle and legend (two or more series), and a Table switch so every value is
 * reachable without hovering. The switch keeps its name and says whether it is on (pressed), as on the phone.
 */
export function ChartCard({
  title,
  subtitle,
  legend,
  table,
  empty,
  emptyText = CHART_EMPTY_TEXT,
  className,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  legend?: LegendItem[];
  table: ChartTableData;
  empty?: boolean;
  emptyText?: string;
  className?: string;
  children: ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);
  const headingId = useId();
  return (
    <Card as="section" className={clsx("min-w-0 p-4", className)}>
      <>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={headingId} className="text-sm font-semibold text-slate-900">
              {title}
            </h2>
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {!empty && (
            <button
              type="button"
              aria-pressed={showTable}
              onClick={() => setShowTable((v) => !v)}
              className={clsx(
                "shrink-0 rounded-md border px-2 py-1 text-xs font-medium",
                showTable ? "border-slate-300 bg-slate-100 text-slate-900" : "border-slate-200 text-slate-600 hover:bg-slate-50",
              )}
            >
              Table
            </button>
          )}
        </div>
        {legend && legend.length >= 2 && !showTable && !empty && (
          <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600" aria-label="Legend">
            {legend.map((l) => (
              <li key={l.label} className="flex items-center gap-1.5">
                <span aria-hidden className={l.kind === "line" ? "inline-block h-0.5 w-4 rounded-full" : "inline-block h-2.5 w-2.5 rounded-sm"} style={{ background: l.color }} />
                {l.label}
              </li>
            ))}
          </ul>
        )}
        {empty ? (
          <p className="py-8 text-center text-sm text-slate-500">{emptyText}</p>
        ) : showTable ? (
          <div className="max-h-72 overflow-auto rounded-lg border border-slate-100">
            <table className="w-full text-xs">
              <caption className="sr-only">{title}</caption>
              <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
                <tr>
                  {table.columns.map((c, i) => (
                    <th key={c} scope="col" className={clsx("px-3 py-1.5 font-medium", i > 0 && "text-right")}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {table.rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((cell, j) => (
                      <td key={j} className={clsx("px-3 py-1.5", j > 0 && "text-right tabular-nums")}>
                        {tableCellText(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          children
        )}
      </>
    </Card>
  );
}
