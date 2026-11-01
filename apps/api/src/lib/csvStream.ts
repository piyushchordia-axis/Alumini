import { csvLine } from "@illuminize/shared";
import type { Response } from "express";
import { once } from "node:events";

export interface CsvStreamResult {
  rows: number;
  /** False when the client went away before the last row. */
  complete: boolean;
}

/** Waits until the socket has room for more, or the client has gone. */
async function drained(res: Response): Promise<void> {
  const ac = new AbortController();
  try {
    await Promise.race([once(res, "drain", { signal: ac.signal }), once(res, "close", { signal: ac.signal })]);
  } finally {
    ac.abort();
  }
}

/**
 * Streams a CSV download page by page: a UTF-8 BOM (so Excel reads accents and scripts correctly), the header, then
 * each page as the source yields it, waiting for the socket to drain in between so memory stays flat however many
 * rows there are. The first page is fetched before anything is sent, so a failing query still gets a normal JSON
 * error; a failure after that reaches the error handler with headers sent, which cuts the connection.
 */
export async function streamCsv(res: Response, filename: string, header: string[], pages: AsyncIterable<unknown[][]>): Promise<CsvStreamResult> {
  const it = pages[Symbol.asyncIterator]();
  let next = await it.next();
  res.status(200);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename.replace(/[^\w.-]/g, "_")}"`);
  res.setHeader("Cache-Control", "no-store");
  let rows = 0;
  let chunk = "\uFEFF" + csvLine(header);
  try {
    while (!next.done) {
      chunk += next.value.map(csvLine).join("");
      rows += next.value.length;
      if (!res.write(chunk)) await drained(res);
      chunk = "";
      if (res.destroyed) return { rows, complete: false };
      next = await it.next();
    }
    if (chunk) res.write(chunk);
    res.end();
    return { rows, complete: true };
  } finally {
    if (!next.done) await it.return?.();
  }
}
