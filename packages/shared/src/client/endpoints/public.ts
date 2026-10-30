import type { PushTokenInput } from "../../schemas/auth";
import type { AuthSessionDto, MeDto, OtpRequestResultDto, TenantPublicDto, TenantSummaryDto, TokenPairDto } from "../../types/dto";
import type { ApiCore } from "../core";

export function tenantEndpoints(core: ApiCore) {
  return {
    list: (q?: string) => core.data<TenantSummaryDto[]>({ path: "/tenants", query: { q }, auth: false }),
    get: (slug: string) => core.data<TenantPublicDto>({ path: `/tenants/${encodeURIComponent(slug)}`, auth: false }),
  };
}

export function authEndpoints(core: ApiCore) {
  return {
    requestOtp: (phone: string) => core.data<OtpRequestResultDto>({ method: "POST", path: "/auth/otp/request", body: { phone }, auth: false }),
    verifyOtp: async (phone: string, code: string) => {
      const session = await core.data<AuthSessionDto>({ method: "POST", path: "/auth/otp/verify", body: { phone, code }, auth: false });
      await core.setTokens({ accessToken: session.accessToken, refreshToken: session.refreshToken });
      return session;
    },
    refresh: (refreshToken: string) => core.data<TokenPairDto>({ method: "POST", path: "/auth/refresh", body: { refreshToken }, auth: false }),
    logout: async (refreshToken?: string | null) => {
      try {
        await core.request({ method: "POST", path: "/auth/logout", body: { refreshToken: refreshToken ?? undefined } });
      } finally {
        await core.clearTokens();
      }
    },
    logoutAll: async () => {
      try {
        await core.request({ method: "POST", path: "/auth/logout-all" });
      } finally {
        await core.clearTokens();
      }
    },
  };
}

export function meEndpoints(core: ApiCore) {
  return {
    get: () => core.data<MeDto>({ path: "/me" }),
    registerPushToken: (input: PushTokenInput) => core.request<void>({ method: "POST", path: "/me/push-tokens", body: input }),
    removePushToken: (token: string) => core.request<void>({ method: "DELETE", path: `/me/push-tokens/${encodeURIComponent(token)}` }),
    deleteAccount: async () => {
      await core.request<void>({ method: "POST", path: "/me/delete", body: { confirm: true } });
      await core.clearTokens();
    },
  };
}
