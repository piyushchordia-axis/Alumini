import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { AppError } from "../lib/errors";
import type { Logger } from "../lib/logger";

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: `Route ${req.method} ${req.path} not found` } });
};

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err: unknown, req, res, _next) => {
    if (res.headersSent) return;

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

    logger.error({ err, reqId: req.id, method: req.method, url: req.originalUrl }, "Unhandled error");
    res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong" } });
  };
}
