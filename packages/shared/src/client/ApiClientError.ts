import type { ErrorCode } from "../errorCodes";

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: ErrorCode | "NETWORK_ERROR";
  readonly details?: unknown;

  constructor(status: number, code: ErrorCode | "NETWORK_ERROR", message: string, details?: unknown) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Validation details as `{ path: message }`, when present. */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    if (Array.isArray(this.details)) {
      for (const d of this.details as Array<{ path?: string; message?: string }>) {
        if (d && typeof d.path === "string" && typeof d.message === "string" && !out[d.path]) out[d.path] = d.message;
      }
    }
    return out;
  }
}

export function isApiClientError(err: unknown): err is ApiClientError {
  return err instanceof ApiClientError;
}

export function errorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (isApiClientError(err)) return err.message;
  if (err instanceof Error) return err.message || fallback;
  return fallback;
}
