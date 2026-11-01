import { csvCell, csvLine, isExcelScientific, parseCsv, parseCsvRecords } from "@illuminize/shared";
import { describe, expect, it } from "vitest";

describe("CSV", () => {
  it("parses quotes, embedded delimiters and newlines, CRLF and a BOM", () => {
    const text = '\uFEFFPhone,Name,Batch Year\r\n+919876543210,"Rao, Asha",2012\r\n9876500000,"Said ""hi""\nthen left",\r\n\r\n';
    const parsed = parseCsv(text);
    expect(parsed.headers).toEqual(["phone", "name", "batch_year"]);
    expect(parsed.rows).toEqual([
      { phone: "+919876543210", name: "Rao, Asha", batch_year: "2012" },
      { phone: "9876500000", name: 'Said "hi"\nthen left', batch_year: "" },
    ]);
  });

  it("detects semicolon and tab delimiters", () => {
    expect(parseCsvRecords("a;b;c\n1;2,5;3")).toEqual([
      ["a", "b", "c"],
      ["1", "2,5", "3"],
    ]);
    expect(parseCsvRecords("a\tb\n1\t2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("spots numbers Excel turned into scientific notation", () => {
    expect(isExcelScientific("9.19876E+11")).toBe(true);
    expect(isExcelScientific("9.19876e+11")).toBe(true);
    expect(isExcelScientific("+919876543210")).toBe(false);
  });

  it("writes cells safely (quotes, formula prefixes)", () => {
    expect(csvCell('He said "hi", then left')).toBe('"He said ""hi"", then left"');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("+919876543210")).toBe("'+919876543210");
    expect(csvCell(["a", "b"])).toBe('"a; b"');
    expect(csvCell(null)).toBe("");
    expect(csvLine(["x", 1, true])).toBe("x,1,true\r\n");
  });
});
