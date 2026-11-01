import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { AppError } from "../lib/errors";
import type { Logger } from "../lib/logger";

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: `Route ${req.method} ${req.path} not found` } });
};

/** Postgres error from a query, unwrapped from Drizzle's DrizzleQueryError (`cause`). */
function pgError(err: unknown): { code?: string; constraint?: string } | null {
  for (let e = err as { code?: unknown; cause?: unknown } | null, depth = 0; e && depth < 3; e = e.cause as typeof e, depth++) {
    if (typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code)) return e as { code: string; constraint?: string };
  }
  return null;
}

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err: unknown, req, res, _next) => {
    // A streamed response (a CSV export) failed midway: the status is already sent, so cut the connection rather than
    // leave the client waiting on a body that will never finish.
    if (res.headersSent) {
      logger.error({ err, path: req.path }, "Error after the response started");
      res.destroy(err instanceof Error ? err : undefined);
      return;
    }

    if (err instanceof AppError) {
      if (err.status === 429 && err.details && typeof err.details === "object" && "retryAfterSec" in err.details) {
        res.setHeader("Retry-After", String((err.details as { retryAfterSec: number }).retryAfterSec));
      }
      res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
      return;
    }

    if (err instanceof ZodError) {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message, code: i.code })),
        },
      });
      return;
    }

    const anyErr = err as { type?: string; status?: number; code?: string; message?: string; name?: string };

    if (anyErr?.type === "entity.too.large") {
      res.status(413).json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Request body too large" } });
      return;
    }
    if (anyErr?.type === "entity.parse.failed" || (err instanceof SyntaxError && "body" in (err as object))) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Malformed JSON body" } });
      return;
    }
    if (anyErr?.name === "MulterError") {
      if (anyErr.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({ error: { code: "PAYLOAD_TOO_LARGE", message: "File too large" } });
        return;
      }
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: anyErr.message ?? "Upload failed" } });
      return;
    }

    const pg = pgError(err);
    if (pg?.code === "23505") {
      // Two requests raced to create the same thing (double-tap register, RSVP, slug). The first one won.
      logger.warn({ constraint: pg.constraint, reqId: req.id, url: req.originalUrl }, "Unique constraint conflict");
      res.status(409).json({ error: { code: "CONFLICT", message: "That already exists. Refresh and try again." } });
      return;
    }
    if (pg?.code === "22P02" || pg?.code === "22007" || pg?.code === "22008") {
      // Invalid text representation (e.g. a malformed uuid) or an impossible date that slipped past validation.
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid value in request" } });
      return;
    }

    logger.error({ err, reqId: req.id, method: req.method, url: req.originalUrl }, "Unhandled error");
    res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong" } });
  };
}
