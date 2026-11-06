import { describe, expect, it } from "vitest";
import {
  columnLayout,
  columnReadoutRows,
  edgeAnchor,
  formatCompact,
  formatWeek,
  lineLayout,
  lineReadoutRows,
  nearestIndex,
  niceTicks,
  plural,
  readoutText,
  SERIES,
  spreadLabels,
  stepIndex,
  tableCellText,
  tickFormatter,
  tooltipLeft,
  unitFor,
  weekTitle,
} from "@illuminize/shared";

describe("the series palette", () => {
  it("keeps the validated colours in their fixed order", () => {
    expect(SERIES).toEqual(["#2a78d6", "#eb6834", "#1baf7a", "#eda100"]);
  });
});

describe("niceTicks", () => {
  it("gives an empty axis a top of 1", () => {
    expect(niceTicks(0)).toEqual([0, 1]);
    expect(niceTicks(-3)).toEqual([0, 1]);
  });

  it("steps by 1, 2 or 5 times a power of ten, to just above the largest value", () => {
    expect(niceTicks(1)).toEqual([0, 1]);
    expect(niceTicks(7)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(123)).toEqual([0, 50, 100, 150]);
    expect(niceTicks(10_400)).toEqual([0, 5000, 10_000, 15_000]);
    expect(niceTicks(4000)).toEqual([0, 1000, 2000, 3000, 4000]);
  });
});

describe("formatCompact", () => {
  it("writes small counts in full and larger ones to a decimal, without Intl", () => {
    expect(formatCompact(0)).toBe("0");
    expect(formatCompact(950)).toBe("950");
    expect(formatCompact(10_000)).toBe("10K");
    expect(formatCompact(12_345)).toBe("12.3K");
    expect(formatCompact(15_000)).toBe("15K");
    expect(formatCompact(1_234_567)).toBe("1.2M");
    expect(formatCompact(2_000_000_000)).toBe("2B");
    expect(formatCompact(-12_345)).toBe("-12.3K");
  });

  it("rounds up into the next unit rather than writing 1000K", () => {
    expect(formatCompact(999_950)).toBe("1M");
    expect(formatCompact(999_949)).toBe("999.9K");
    expect(formatCompact(999.96)).toBe("1K");
  });
});

describe("tickFormatter", () => {
  it("writes axis numbers in full below 10,000 and compact from there", () => {
    expect(tickFormatter(9999)(5000)).toBe("5,000");
    expect(tickFormatter(10_000)(5000)).toBe("5K");
    expect(tickFormatter(15_000)(15_000)).toBe("15K");
  });
});

describe("formatWeek", () => {
  it("writes a week's Monday as the day and month, by hand rather than in the device's locale", () => {
    expect(formatWeek("2026-11-02")).toBe("2 Nov");
    expect(formatWeek("2026-11-02", true)).toBe("2 Nov 2026");
    expect(weekTitle("2026-11-02")).toBe("Week of 2 Nov 2026");
  });

  it("reads the date from its text, so it is never a day out", () => {
    expect(formatWeek("2026-01-05")).toBe("5 Jan");
    expect(formatWeek("2025-12-29", true)).toBe("29 Dec 2025");
  });

  it("gives back what isn't a date as it is", () => {
    expect(formatWeek("not a week")).toBe("not a week");
    expect(formatWeek("2026-02-30", true)).toBe("2026-02-30");
  });
});

describe("units", () => {
  it("agree with their count", () => {
    const members = plural("member", "members");
    expect(unitFor(members, 1)).toBe("member");
    expect(unitFor(members, 0)).toBe("members");
    expect(unitFor("approved", 2)).toBe("approved");
  });

  it("table cells group figures and leave text alone", () => {
    expect(tableCellText(12_345)).toBe("12,345");
    expect(tableCellText("84%")).toBe("84%");
  });
});

describe("columnLayout", () => {
  it("makes room on the left for the longest axis number", () => {
    expect(columnLayout({ values: [1, 3, 2], width: 300, height: 200 }).m.left).toBe(24);
    // The axis reaches 1,500: five characters at 7px, and 10px of space.
    const wide = columnLayout({ values: [1200, 900], width: 300, height: 200 });
    expect(wide.ticks.at(-1)?.text).toBe("1,500");
    expect(wide.m.left).toBe(5 * 7 + 10);
    expect(wide.innerW).toBe(300 - 45 - 8);
  });

  it("keeps columns between 2 and 24px wide, centred in their bands", () => {
    const few = columnLayout({ values: [1, 2], width: 300, height: 200 });
    expect(few.barW).toBe(24);
    expect(few.xCenter(0)).toBe(few.m.left + few.band / 2);
    const many = columnLayout({ values: new Array(200).fill(1), width: 300, height: 200 });
    expect(many.barW).toBe(2);
  });

  it("draws every few axis labels when they don't fit, always the last", () => {
    const n = 52;
    const l = columnLayout({ values: new Array(n).fill(1), width: 320, height: 200 });
    const shown = l.axisLabels.map((a) => a.index);
    expect(shown.at(-1)).toBe(n - 1);
    expect(shown.length).toBeLessThan(n);
    const gap = shown[1]! - shown[0]!;
    expect(gap).toBeGreaterThan(1);
    expect(shown.every((i, k) => k === 0 || i - shown[k - 1]! === gap)).toBe(true);
    // Few enough to fit: all of them.
    expect(columnLayout({ values: [1, 2, 3], width: 600, height: 200 }).axisLabels).toHaveLength(3);
  });

  it("keeps the axis labels at the edges inside the chart", () => {
    // 52 narrow columns: the last one's centre is closer to the right edge than half a label.
    const l = columnLayout({ values: new Array(52).fill(1), width: 320, height: 200 });
    expect(l.axisLabels.at(-1)).toMatchObject({ index: 51, anchor: "end" });
    expect(l.axisLabels.at(-1)!.x).toBeLessThanOrEqual(320);
    expect(l.axisLabels[0]?.anchor).toBe("middle");
    expect(edgeAnchor(10, 300)).toEqual({ x: 4, anchor: "start" });
    expect(edgeAnchor(150, 300)).toEqual({ x: 150, anchor: "middle" });
    expect(edgeAnchor(295, 300)).toEqual({ x: 300, anchor: "end" });
  });

  it("puts the tallest column's value on its cap, and nothing when every value is 0", () => {
    const l = columnLayout({ values: [3, 9, 9, 1], width: 300, height: 200 });
    expect(l.peak).toMatchObject({ index: 1, text: "9", x: l.xCenter(1), y: l.y(9) - 5 });
    expect(columnLayout({ values: [0, 0], width: 300, height: 200 }).peak).toBeNull();
    expect(columnLayout({ values: [0, 0], width: 300, height: 200 }).bar(0)).toBe("");
  });

  it("puts 0 on the baseline and the top tick at the top of the plot", () => {
    const l = columnLayout({ values: [7], width: 300, height: 200 });
    expect(l.baseline).toBe(200 - 22);
    expect(l.ticks.at(-1)?.y).toBe(18);
  });
});

describe("lineLayout", () => {
  it("leaves room for the end labels on the right, never more than 120px", () => {
    const one = lineLayout({ series: [{ name: "Active members", values: [3, 12] }], n: 2, width: 400, height: 220 });
    // A single line's label is its latest value only.
    expect(one.ends[0]?.text).toBe("12");
    expect(one.m.right).toBe(2 * 6.5 + 14);
    const long = lineLayout({ series: [{ name: "A very long series name indeed", values: [1, 2] }, { name: "Jobs", values: [0, 1] }], n: 2, width: 400, height: 220 });
    expect(long.ends[0]?.text).toBe("A very long series name indeed 2");
    expect(long.m.right).toBe(120);
  });

  it("centres a single point", () => {
    const l = lineLayout({ series: [{ name: "Posts", values: [4] }], n: 1, width: 400, height: 220 });
    expect(l.x(0)).toBe(l.m.left + l.innerW / 2);
  });

  it("runs from the first category at the left of the plot to the last at its right", () => {
    const l = lineLayout({ series: [{ name: "Posts", values: [0, 2, 4] }], n: 3, width: 400, height: 220 });
    expect(l.x(0)).toBe(l.m.left);
    expect(l.x(2)).toBe(l.m.left + l.innerW);
    expect(l.path([0, 2, 4])).toBe(`M${l.x(0)},${l.y(0)}L${l.x(1)},${l.y(2)}L${l.x(2)},${l.y(4)}`);
  });

  it("washes the area under a single line only", () => {
    expect(lineLayout({ series: [{ name: "Posts", values: [1, 2] }], n: 2, width: 400, height: 220 }).area).toMatch(/Z$/);
    expect(lineLayout({ series: [{ name: "Posts", values: [1, 2] }, { name: "Jobs", values: [2, 1] }], n: 2, width: 400, height: 220 }).area).toBeNull();
  });

  it("spreads end labels that would overlap", () => {
    const l = lineLayout({ series: [{ name: "Posts", values: [5, 5] }, { name: "Comments", values: [5, 5] }], n: 2, width: 400, height: 220 });
    expect(Math.abs(l.ends[0]!.labelY - l.ends[1]!.labelY)).toBeGreaterThanOrEqual(13);
    expect(l.ends[0]!.y).toBe(l.ends[1]!.y);
  });
});

describe("spreadLabels", () => {
  it("keeps labels at least the gap apart, inside the bounds, in their order", () => {
    const ys = spreadLabels([50, 52, 51], 13, 10, 200);
    const sorted = [...ys].sort((a, b) => a - b);
    for (let k = 1; k < sorted.length; k++) expect(sorted[k]! - sorted[k - 1]!).toBeGreaterThanOrEqual(13);
    expect(ys[0]).toBeLessThan(ys[2]!);
    expect(ys[2]).toBeLessThan(ys[1]!);
    expect(spreadLabels([5], 13, 10, 200)).toEqual([10]);
    const atBottom = spreadLabels([199, 200], 13, 10, 200);
    expect(atBottom).toEqual([187, 200]);
  });
});

describe("nearestIndex", () => {
  const columns = columnLayout({ values: [1, 2, 3, 4], width: 232, height: 200 });
  const lines = lineLayout({ series: [{ name: "Posts", values: [1, 2, 3, 4, 5] }], n: 5, width: 400, height: 220 });

  it("finds the column whose band holds the point", () => {
    expect(nearestIndex(0, columns)).toBe(0);
    expect(nearestIndex(columns.m.left + columns.band * 1.5, columns)).toBe(1);
    expect(nearestIndex(columns.m.left + columns.band * 2 - 0.5, columns)).toBe(1);
    expect(nearestIndex(columns.m.left + columns.band * 2, columns)).toBe(2);
    expect(nearestIndex(10_000, columns)).toBe(3);
  });

  it("finds the nearest point on a line", () => {
    expect(nearestIndex(0, lines)).toBe(0);
    expect(nearestIndex(lines.x(2) + 1, lines)).toBe(2);
    expect(nearestIndex((lines.x(2) + lines.x(3)) / 2 + 1, lines)).toBe(3);
    expect(nearestIndex(10_000, lines)).toBe(4);
  });

  it("has only the first for a single category or a chart not yet measured", () => {
    expect(nearestIndex(300, columnLayout({ values: [3], width: 300, height: 200 }))).toBe(0);
    expect(nearestIndex(300, columnLayout({ values: [1, 2], width: 0, height: 200 }))).toBe(0);
  });
});

describe("stepIndex", () => {
  it("steps through the categories and stops at the ends", () => {
    expect(stepIndex(null, 5, 1)).toBe(0);
    expect(stepIndex(null, 5, -1)).toBe(4);
    expect(stepIndex(2, 5, 1)).toBe(3);
    expect(stepIndex(2, 5, -1)).toBe(1);
    expect(stepIndex(4, 5, 1)).toBe(4);
    expect(stepIndex(0, 5, -1)).toBe(0);
  });
});

describe("tooltipLeft", () => {
  it("centres a box over its mark, inside the chart", () => {
    expect(tooltipLeft(200, 400, 176)).toBe(112);
    expect(tooltipLeft(10, 400, 176)).toBe(0);
    expect(tooltipLeft(395, 400, 176)).toBe(224);
  });

  it("puts a box beside a crosshair, on whichever side it fits", () => {
    expect(tooltipLeft(100, 400, 176, true)).toBe(112);
    expect(tooltipLeft(300, 400, 176, true)).toBe(112);
  });
});

describe("readouts", () => {
  it("say a column's value and unit", () => {
    expect(columnReadoutRows(1, plural("member", "members"))).toEqual([{ value: "1", label: "member" }]);
    expect(readoutText("Week of 2 Nov 2026", columnReadoutRows(1234, "approved"))).toBe("Week of 2 Nov 2026, 1,234 approved");
  });

  it("list every line, with colour keys only when there are several", () => {
    const one = lineReadoutRows([{ name: "Active members", values: [3, 12], color: SERIES[0] }], 1);
    expect(one).toEqual([{ value: "12", label: "Active members", color: undefined }]);
    const two = lineReadoutRows(
      [
        { name: "Posts", values: [4], color: SERIES[0] },
        { name: "Comments", values: [9], color: SERIES[1] },
      ],
      0,
    );
    expect(two.map((r) => r.color)).toEqual([SERIES[0], SERIES[1]]);
    expect(readoutText("Week of 2 Nov 2026", two)).toBe("Week of 2 Nov 2026, Posts 4, Comments 9");
  });
});
