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

/**
 * The server couldn't be reached, broke or is limiting this client, none of which says anything about the resource or
 * the session. Any other status is the API's answer. A 429 reaches a guard's query when the token refresh behind it is limited.
 */
export function isTransientError(err: unknown): boolean {
  return isApiClientError(err) && (err.status === 0 || err.status === 429 || err.status >= 500);
}

/**
 * The error a route guard must act on, or null. A failed background refetch must not replace an open screen, so a
 * transient failure with data still cached doesn't count. An answer from the API always does, cached data or not.
 */
export function fatalQueryError<E>(query: { data: unknown; error: E | null }): E | null {
  return query.data != null && isTransientError(query.error) ? null : query.error;
}

/** Query `meta` for data a route guard acts on: the institution and the member's own membership. */
export const GUARD_QUERY_META = { guard: true };

/**
 * For a QueryCache's `onError`. A failed query keeps its data and only remembers the latest error, so a transient failure
 * after an answer such as NOT_A_MEMBER would erase the answer and reopen the app from the old data. An answer therefore
 * takes a guard query's data with it, and only a success brings data back.
 */
export function forgetGuardDataOnAnswer(error: unknown, query: { meta?: Record<string, unknown>; setState(state: { data: undefined; dataUpdatedAt: number }): void }): void {
  if (query.meta?.guard && isApiClientError(error) && !isTransientError(error)) query.setState({ data: undefined, dataUpdatedAt: 0 });
}

export function errorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (isApiClientError(err)) return err.message;
  if (err instanceof Error) return err.message || fallback;
  return fallback;
}
