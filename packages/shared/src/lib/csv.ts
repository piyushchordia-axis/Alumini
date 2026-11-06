/**
 * Small RFC 4180 CSV reader/writer used for invitation imports (in the browser) and exports. Handles a UTF-8 BOM,
 * CRLF or LF line ends, quoted fields with embedded quotes, commas and newlines, and ";" as the delimiter (what Excel
 * writes in many European and some Indian locales).
 */

export interface ParsedCsv {
  headers: string[];
  /** One object per data row, keyed by header; blank lines are skipped. */
  rows: Record<string, string>[];
}

function detectDelimiter(text: string): "," | ";" | "\t" {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const counts = { ",": 0, ";": 0, "\t": 0 } as Record<"," | ";" | "\t", number>;
  let quoted = false;
  for (const ch of firstLine) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch in counts) counts[ch as "," | ";" | "\t"]++;
  }
  return counts[";"] > counts[","] && counts[";"] >= counts["\t"] ? ";" : counts["\t"] > counts[","] ? "\t" : ",";
}

/** Splits CSV text into records of raw string fields. */
export function parseCsvRecords(input: string, delimiter?: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const d = delimiter ?? detectDelimiter(text);
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let i = 0;
  let quoted = false;
  while (i < text.length) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === "") {
      quoted = true;
      i++;
    } else if (ch === d) {
      record.push(field);
      field = "";
      i++;
    } else if (ch === "\r" || ch === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
      i += ch === "\r" && text[i + 1] === "\n" ? 2 : 1;
    } else {
      field += ch;
      i++;
    }
  }
  if (field !== "" || record.length) {
    record.push(field);
    records.push(record);
  }
  return records.filter((r) => r.some((f) => f.trim() !== ""));
}

/** Header names are normalised: trimmed, lower-cased, spaces and dashes to "_" ("Batch Year" → "batch_year"). */
export const normalizeCsvHeader = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

export function parseCsv(text: string): ParsedCsv {
  const [head, ...body] = parseCsvRecords(text);
  const headers = (head ?? []).map(normalizeCsvHeader);
  return {
    headers,
    rows: body.map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()]))),
  };
}

/** True for numbers Excel has mangled into scientific notation (e.g. a phone number shown as 9.19876E+11). */
export const isExcelScientific = (s: string) => /^\d(\.\d+)?e\+\d+$/i.test(s.trim());

/**
 * Escapes one cell. Cells starting with = + - @ (or a tab/CR) get a leading ' so spreadsheet apps treat them as text,
 * not formulas (CSV injection). Note this also prefixes "+91…" phone numbers.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = Array.isArray(value) ? value.join("; ") : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csvLine = (cells: unknown[]) => cells.map(csvCell).join(",") + "\r\n";

/**
 * CSV text with the UTF-8 byte order mark in front, once, so Excel reads names in any script. A file read with
 * Response.text() has lost the one the server wrote, so a phone saving an export puts it back.
 */
export const withBom = (text: string) => (text.charCodeAt(0) === 0xfeff ? text : `\uFEFF${text}`);
