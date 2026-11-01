import { ApiClientError } from "./ApiClientError";
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

  /** Performs a request and returns the parsed JSON body (the full envelope). */
  async request<T>(opts: RequestOptions, isRetry = false): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json", ...(this.opts.headers ?? {}) };
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
      });
    } catch (err) {
      throw new ApiClientError(0, "NETWORK_ERROR", "Could not reach the server. Check your connection.", err);
    }

    if (res.status === 204) return undefined as T;

    let json: unknown = null;
    const text = await res.text();
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }

    if (res.ok) return json as T;

    const errBody = (json as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    const code = (errBody?.code ?? "INTERNAL") as ApiClientError["code"];
    const message = errBody?.message ?? `Request failed (${res.status})`;

    if (res.status === 401 && useAuth && !isRetry && code === "TOKEN_EXPIRED") {
      const refreshed = await this.refresh();
      if (refreshed) return this.request<T>(opts, true);
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

  async data<T>(opts: RequestOptions): Promise<T> {
    const body = await this.request<{ data: T } | undefined>(opts);
    return (body as { data: T } | undefined)?.data as T;
  }

  /** Single-flight refresh: concurrent 401s share one refresh call. */
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
    } catch {
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
