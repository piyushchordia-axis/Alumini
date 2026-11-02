import { Writable } from "node:stream";
import { createLogger } from "../../src/lib/logger";

/** A logger writing to a string a test can read. */
export function capturingLogger() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      lines.push(String(chunk));
      done();
    },
  });
  return { logger: createLogger("info", false, stream), text: () => lines.join("") };
}
