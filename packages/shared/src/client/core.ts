import { ApiClientError, isTransientError } from "./ApiClientError";
import type { TokenPair, TokenStorage } from "./TokenStorage";

export interface ApiClientOptions {
  /** Origin of the API, e.g. https://api.illuminize.app. Empty string = same origin. */
  baseUrl: string;
  storage: TokenStorage;
  /** Called when the session cannot be recovered (refresh failed or session revoked). */
  onUnauthorized?: () => void;
  fetch?: typeof fetch;
  /** Extra headers on every request (e.g. app version). */
  headers?: Record<string, string>;
}

/** Query values; an array repeats the parameter (?field=a&field=b). */
export type QueryParams = Record<string, string | number | boolean | null | undefined | string[]>;

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  tenantSlug?: string;
  query?: QueryParams;
  body?: unknown;
  formData?: FormData;
  auth?: boolean;
  /** Aborting gives up on the request, which then fails as a network error. */
  signal?: AbortSignal;
}

export function buildQuery(query?: QueryParams): string {
  if (!query) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    for (const item of Array.isArray(v) ? v : [v]) parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(item))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

export class ApiCore {
  private refreshing: Promise<TokenPair | null> | null = null;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: ApiClientOptions) {
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
  }

  get baseUrl(): string {
    return this.opts.baseUrl.replace(/\/$/, "");
  }

  url(opts: Pick<RequestOptions, "path" | "tenantSlug" | "query">): string {
    const prefix = opts.tenantSlug ? `/api/v1/t/${encodeURIComponent(opts.tenantSlug)}` : "/api/v1";
    return `${this.baseUrl}${prefix}${opts.path}${buildQuery(opts.query)}`;
  }

  /**
   * Sends a request with the access token, refreshing it once on TOKEN_EXPIRED, and returns the successful Response
   * (its body unread). Error responses become ApiClientError. Shared by JSON requests and downloads.
   */
  private async send(opts: RequestOptions, accept: string, isRetry = false): Promise<Response> {
    const headers: Record<string, string> = { Accept: accept, ...(this.opts.headers ?? {}) };
    if (opts.body !== undefined && !opts.formData) headers["Content-Type"] = "application/json";
    const useAuth = opts.auth ?? true;
    if (useAuth) {
      const token = await this.opts.storage.getAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    let res: Response;
    try {
      res = await this.fetchImpl(this.url(opts), {
        method: opts.method ?? "GET",
        headers,
        body: opts.formData ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
    } catch (err) {
      throw new ApiClientError(0, "NETWORK_ERROR", "Could not reach the server. Check your connection.", err);
    }
    if (res.ok) return res;

    let json: unknown = null;
    const text = await res.text();
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    const errBody = (json as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    const code = (errBody?.code ?? "INTERNAL") as ApiClientError["code"];
    const message = errBody?.message ?? `Request failed (${res.status})`;

    if (res.status === 401 && useAuth && !isRetry && code === "TOKEN_EXPIRED") {
      // A refresh that got no answer rejects here, so the caller sees that failure and the session below is left alone.
      const refreshed = await this.refresh();
      if (refreshed) return this.send(opts, accept, true);
    }
    if (res.status === 401 && useAuth && (code === "SESSION_REVOKED" || code === "TOKEN_EXPIRED" || code === "UNAUTHENTICATED")) {
      const hadToken = !!(await this.opts.storage.getAccessToken());
      if (hadToken) {
        await this.opts.storage.clear();
        this.opts.onUnauthorized?.();
      }
    }
    throw new ApiClientError(res.status, code, message, errBody?.details);
  }

  /** Performs a request and returns the parsed JSON body (the full envelope). */
  async request<T>(opts: RequestOptions): Promise<T> {
    const res = await this.send(opts, "application/json");
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (!text) return null as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return null as T;
    }
  }

  /** Fetches a file (a CSV export) with the same sign-in and refresh handling; the file name comes from the server. */
  async download(opts: RequestOptions): Promise<{ blob: Blob; filename: string | null }> {
    const res = await this.send(opts, "*/*");
    const disposition = res.headers.get("Content-Disposition") ?? "";
    const filename = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? null;
    return { blob: await res.blob(), filename };
  }

  async data<T>(opts: RequestOptions): Promise<T> {
    const body = await this.request<{ data: T } | undefined>(opts);
    return (body as { data: T } | undefined)?.data as T;
  }

  /**
   * Single-flight refresh: concurrent 401s share one refresh call. Resolves null when the session is over. Rejects with a
   * transient error when the refresh got no answer, which says nothing about the session, so the tokens stay.
   */
  refresh(): Promise<TokenPair | null> {
    if (!this.refreshing) {
      this.refreshing = this.doRefresh().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  private async doRefresh(): Promise<TokenPair | null> {
    const refreshToken = await this.opts.storage.getRefreshToken();
    if (!refreshToken) return null;
    try {
      const body = await this.request<{ data: TokenPair }>({ method: "POST", path: "/auth/refresh", body: { refreshToken }, auth: false });
      await this.opts.storage.setTokens(body.data);
      return body.data;
    } catch (err) {
      if (isTransientError(err)) throw err;
      await this.opts.storage.clear();
      this.opts.onUnauthorized?.();
      return null;
    }
  }

  async setTokens(tokens: TokenPair): Promise<void> {
    await this.opts.storage.setTokens(tokens);
  }

  async clearTokens(): Promise<void> {
    await this.opts.storage.clear();
  }
}
