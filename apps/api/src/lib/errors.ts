import type { ErrorCode } from "@illuminize/shared";

export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(status: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message: string, details?: unknown) {
    return new AppError(400, "VALIDATION_ERROR", message, details);
  }
  static unauthenticated(message = "Authentication required") {
    return new AppError(401, "UNAUTHENTICATED", message);
  }
  static forbidden(message = "You do not have permission to do that", code: ErrorCode = "FORBIDDEN", details?: unknown) {
    return new AppError(403, code, message, details);
  }
  static notFound(message = "Not found", code: ErrorCode = "NOT_FOUND") {
    return new AppError(404, code, message);
  }
  static conflict(message: string, code: ErrorCode = "CONFLICT", details?: unknown) {
    return new AppError(409, code, message, details);
  }
  static invalidTransition(message: string, details?: unknown) {
    return new AppError(409, "INVALID_TRANSITION", message, details);
  }
  static rateLimited(retryAfterSec: number, message = "Too many requests") {
    return new AppError(429, "RATE_LIMITED", message, { retryAfterSec });
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
