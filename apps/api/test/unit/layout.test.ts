import { CHAR_WIDTH_EM, jobFacts, longestWordLength, wordColumnWidth, type JobFactsSource } from "@illuminize/shared";
import { describe, expect, it } from "vitest";
import { fitCellStyle, type FitCellStyle } from "../../../mobile/src/lib/layout";
import { fitColumns } from "../../../web/src/lib/layout";

describe("longestWordLength", () => {
  it("measures the longest word in characters", () => {
    expect(longestWordLength(["Career advice", "Entrepreneurship"])).toBe(16);
    expect(longestWordLength(["Distributed systems engineering"])).toBe(11);
  });

  it("ends a word after a hyphen, a dash or a slash, which stays with the piece before it", () => {
    expect(longestWordLength(["On-site"])).toBe(4);
    expect(longestWordLength(["₹25,000–35,000 a month"])).toBe(8);
    expect(longestWordLength(["Self‐employed"])).toBe(8);
    expect(longestWordLength(["Design—research"])).toBe(8);
    expect(longestWordLength(["B.Tech/B.E."])).toBe(7);
    expect(longestWordLength(["co-"])).toBe(3);
  });

  it("keeps a hyphen or a slash with a digit after it, as browsers and phones draw it (UAX #14's LB25)", () => {
    expect(longestWordLength(["Noida-201301"])).toBe(12);
    expect(longestWordLength(["Sector-62,"])).toBe(10);
    expect(longestWordLength(["Sector-62, Noida-201301"])).toBe(12);
    expect(longestWordLength(["2020-2024"])).toBe(9);
    expect(longestWordLength(["12/2026"])).toBe(7);
    expect(longestWordLength(["B.Tech/2024"])).toBe(11);
    // Digits in an Indian script, and full-width ones, join too.
    expect(longestWordLength(["Ward-१२"])).toBe(7);
    expect(longestWordLength(["Ward-૧૨"])).toBe(7);
    expect(longestWordLength(["No-１２"])).toBe(5);
    // Before a letter they still end the word, and the hyphen U+2010 and the dashes before a digit too.
    expect(longestWordLength(["On-site"])).toBe(4);
    expect(longestWordLength(["B.Tech/B.E."])).toBe(7);
    expect(longestWordLength(["₹25,000–35,000"])).toBe(8);
    expect(longestWordLength(["2020‐2024"])).toBe(5);
  });

  it("keeps a hyphen or a slash that starts a word with the word", () => {
    expect(longestWordLength(["-remote"])).toBe(7);
    expect(longestWordLength(["-5 °C"])).toBe(2);
    expect(longestWordLength(["and /or"])).toBe(3);
  });

  it("counts characters, not UTF-16 units", () => {
    expect(longestWordLength(["₹₹₹"])).toBe(3);
    expect(longestWordLength(["𝔸𝔹ℂ"])).toBe(3);
  });

  it("ends a word at any whitespace but a non-breaking space, which keeps a time or a date together", () => {
    expect(longestWordLength(["one\ttwo\nthree"])).toBe(5);
    expect(longestWordLength(["5:40\u202fpm", "12\u00a0Dec"])).toBe(7);
    expect(longestWordLength(["1\u20070"])).toBe(3);
  });

  it("counts nothing for missing or empty text", () => {
    expect(longestWordLength([null, undefined, "", "   "])).toBe(0);
    expect(longestWordLength([])).toBe(0);
  });
});

describe("wordColumnWidth", () => {
  it("is the word at its size plus the chrome around it", () => {
    expect(wordColumnWidth(10, 14, { chrome: 26 })).toBe(10 * 14 * CHAR_WIDTH_EM + 26);
    expect(wordColumnWidth(10, 14, { chrome: 26 })).toBe(110);
    expect(wordColumnWidth(0, 14, { chrome: 26 })).toBe(26);
  });

  it("never goes under its floor", () => {
    expect(wordColumnWidth(2, 14, { floor: 100 })).toBe(100);
    expect(wordColumnWidth(20, 14, { floor: 100 })).toBe(168);
  });

  it("takes the em given, for text wider than most (capitals, spaced out)", () => {
    expect(wordColumnWidth(10, 12, { em: 0.75 })).toBe(90);
  });

  it("rounds up to a hundredth, in rem as in points, without floating-point dust", () => {
    expect(wordColumnWidth(10, 0.875)).toBe(5.25);
    expect(wordColumnWidth(16, 0.875, { chrome: 1.75 })).toBe(10.15);
    expect(wordColumnWidth(7, 0.8125)).toBe(3.42);
  });
});

/** A job's facts as both apps lay them out: each label over its value. */
const factTexts = (job: Partial<JobFactsSource>) =>
  jobFacts({
    jobType: "FULL_TIME",
    workMode: "REMOTE",
    location: null,
    salaryMinMinor: null,
    salaryMaxMinor: null,
    salaryCurrency: "INR",
    salaryPeriod: "YEAR",
    salaryNote: null,
    experienceMin: 3,
    experienceMax: 6,
    seniority: "MID",
    ...job,
  }).flatMap((f) => [f.label, f.value]);

/**
 * How many cells a wrapping row puts on a line, as Yoga (and CSS, on the web build) decides it: each cell takes its basis,
 * held between its min and max width, and the line takes as many as fit with the gaps between them.
 */
function cellsPerLine(cell: FitCellStyle, width: number, gap: number): number {
  const size = Math.min(width, Math.max(cell.flexBasis, (parseFloat(cell.minWidth) / 100) * width));
  let n = 1;
  while ((n + 1) * size + n * gap <= width) n += 1;
  return n;
}

describe("fitCellStyle (mobile FitGrid)", () => {
  it("starts each cell as wide as the longest word and its chrome, growing to share the row and never wider than it", () => {
    const cell = fitCellStyle(["Experience", "3–6 years"], { fontSize: 14, chrome: 26 });
    expect(cell).toEqual({ flexBasis: 110, flexGrow: 1, maxWidth: "100%", minWidth: "34%" });
  });

  it("caps the columns with a minimum width just over a share of one more", () => {
    expect(fitCellStyle([], { fontSize: 14, max: 2 }).minWidth).toBe("34%");
    expect(fitCellStyle([], { fontSize: 14, max: 3 }).minWidth).toBe("26%");
    expect(fitCellStyle([], { fontSize: 14, max: 1 }).minWidth).toBe("51%");
    // Short words on a wide screen: as many as asked for, never more.
    expect(cellsPerLine(fitCellStyle(["Posts"], { fontSize: 12, max: 2 }), 600, 8)).toBe(2);
    expect(cellsPerLine(fitCellStyle(["Sent"], { fontSize: 11, max: 3 }), 600, 8)).toBe(3);
  });

  it("grows with the phone's text size", () => {
    const at = (fontScale: number) => fitCellStyle(["Experience"], { fontSize: 14, fontScale, chrome: 26 }).flexBasis;
    expect(at(1)).toBe(110);
    expect(at(1.5)).toBe(152);
    expect(at(2)).toBe(194);
  });

  it("puts a job's facts two across where the longest word fits, and one across on a narrow phone or at large text", () => {
    const facts = factTexts({});
    const cell = (fontScale = 1) => fitCellStyle(facts, { fontSize: 14, fontScale, chrome: 26 });
    // The grey box on a 390-point phone, then on a 320-point one.
    expect(cellsPerLine(cell(), 300, 12)).toBe(2);
    expect(cellsPerLine(cell(), 230, 12)).toBe(1);
    expect(cellsPerLine(cell(1.5), 300, 12)).toBe(1);
    // A place name with no space to wrap at takes the whole row, wherever it is in the list.
    expect(cellsPerLine(fitCellStyle(factTexts({ location: "Thiruvananthapuram" }), { fontSize: 14, chrome: 26 }), 300, 12)).toBe(1);
  });

  it("keeps Invitations' five figures three across at the usual text size on a narrow phone, and at Large on a 360dp one", () => {
    // StatGrid's dense tiles: 11pt capitals (em 0.75), padding 8 and a border each side, and no link chevron beside them.
    const labels = ["Not sent", "Sent", "Joined", "Expired", "Can send today"];
    const dense = (fontScale: number) => fitCellStyle(labels, { fontSize: 11, fontScale, em: 0.75, chrome: 2 * 8 + 2, max: 3 });
    // The row: the screen less the header's 16 a side.
    expect(cellsPerLine(dense(1), 320 - 32, 8)).toBe(3);
    expect(cellsPerLine(dense(1.15), 360 - 32, 8)).toBe(3);
    // A chevron's 20 more, where no tile has one, would put them two across there.
    expect(cellsPerLine(fitCellStyle(labels, { fontSize: 11, fontScale: 1.15, em: 0.75, chrome: 2 * 8 + 2 + 20, max: 3 }), 360 - 32, 8)).toBe(2);
  });

  it("measures a place's pin code with the name it's joined to, so a narrow phone doesn't split it", () => {
    // No Experience or Seniority, whose labels would otherwise set the width: "Noida-201301" does, not "Location".
    const facts = factTexts({ workMode: "ON_SITE", location: "Sector-62, Noida-201301", experienceMin: null, experienceMax: null, seniority: null });
    const cell = fitCellStyle(facts, { fontSize: 14, chrome: 26 });
    expect(cell.flexBasis).toBe(12 * 14 * CHAR_WIDTH_EM + 26);
    expect(cellsPerLine(cell, 300, 12)).toBe(2);
    expect(cellsPerLine(cell, 230, 12)).toBe(1);
  });
});

/** The parts of fitColumns' template: the narrowest column, the gaps the cap leaves out, and the most columns. */
function templateParts(template: string) {
  const parts = /^repeat\(auto-fill, minmax\(min\(100%, max\(([\d.]+)rem, \(100% - ([\d.]+)rem\) \/ (\d+)\)\), 1fr\)\)$/.exec(template);
  if (!parts) throw new Error(`unexpected template ${template}`);
  return { column: Number(parts[1]), gaps: Number(parts[2]), max: Number(parts[3]) };
}

/** How many columns `repeat(auto-fill, minmax(…, 1fr))` makes in a grid `width` pixels wide, at 16px to the rem. */
function columnsAt(style: ReturnType<typeof fitColumns>, width: number): number {
  const { column, gaps, max } = templateParts(style.gridTemplateColumns);
  const gap = parseFloat(style.columnGap) * 16;
  const track = Math.min(width, Math.max(column * 16, (width - gaps * 16) / max));
  return Math.max(1, Math.floor((width + gap + 0.001) / (track + gap)));
}

describe("fitColumns (web)", () => {
  it("writes the grid's columns from the longest word, capped at the most asked for", () => {
    expect(fitColumns(["Experience", "3–6 years"], { chrome: 1.75, max: 3, gap: 1 })).toEqual({
      columnGap: "1rem",
      gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, max(7rem, (100% - 2rem) / 3)), 1fr))",
    });
    expect(fitColumns(["Jobs & referrals", "Alumni businesses"], { chrome: 1.5, max: 2, gap: 0.75 })).toEqual({
      columnGap: "0.75rem",
      gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, max(6.75rem, (100% - 0.75rem) / 2)), 1fr))",
    });
    // The defaults: text-sm, two across, 1rem apart.
    expect(fitColumns(["Entrepreneurship"]).gridTemplateColumns).toBe("repeat(auto-fill, minmax(min(100%, max(8.4rem, (100% - 1rem) / 2)), 1fr))");
  });

  it("lays a job's facts three across on a wide page, two on a 390px phone and one on a 320px phone", () => {
    const style = fitColumns(factTexts({}), { chrome: 1.75, max: 3, gap: 1 });
    expect(columnsAt(style, 2000)).toBe(3);
    expect(columnsAt(style, 606)).toBe(3);
    expect(columnsAt(style, 292)).toBe(2);
    expect(columnsAt(style, 222)).toBe(1);
    // A place's pin code joined to its name is one word: "Noida-201301", not "Location", sets the width.
    const noida = fitColumns(factTexts({ workMode: "ON_SITE", location: "Sector-62, Noida-201301", experienceMin: null, experienceMax: null, seniority: null }), { chrome: 1.75, max: 3, gap: 1 });
    expect(columnsAt(noida, 292)).toBe(2);
    expect(columnsAt(noida, 222)).toBe(1);
  });

  it("gives a word wider than the row the whole row, and never more", () => {
    const style = fitColumns(["Thiruvananthapuram-Kanyakumari"], { chrome: 1.75, max: 3 });
    expect(columnsAt(style, 292)).toBe(1);
    expect(columnsAt(style, 150)).toBe(1);
  });
});
