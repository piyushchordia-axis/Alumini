import type { PushTokenInput } from "../../schemas/auth";
import type { AuthSessionDto, EmailStatusDto, MeDto, OtpRequestResultDto, TenantPublicDto, TenantSummaryDto, TokenPairDto, UnsubscribeInfoDto } from "../../types/dto";
import type { ApiCore } from "../core";

export function tenantEndpoints(core: ApiCore) {
  return {
    list: (q?: string) => core.data<TenantSummaryDto[]>({ path: "/tenants", query: { q }, auth: false }),
    get: (slug: string) => core.data<TenantPublicDto>({ path: `/tenants/${encodeURIComponent(slug)}`, auth: false }),
  };
}

/** Email unsubscribe links (no sign-in: the signed token is the authority). */
export function unsubscribeEndpoints(core: ApiCore) {
  return {
    info: (token: string) => core.data<UnsubscribeInfoDto>({ path: "/unsubscribe", query: { token }, auth: false }),
    confirm: (token: string) => core.data<UnsubscribeInfoDto>({ method: "POST", path: "/unsubscribe", query: { token }, auth: false }),
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
    /** Confirms an email address from the link in the confirmation email (no sign-in needed). */
    verifyEmail: (token: string) => core.data<{ email: string }>({ method: "POST", path: "/auth/email/verify", body: { token }, auth: false }),
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
    email: {
      get: () => core.data<EmailStatusDto>({ path: "/me/email" }),
      /** Sends a confirmation link; the address replaces the current one only once the link is opened. */
      set: (email: string) => core.data<EmailStatusDto>({ method: "POST", path: "/me/email", body: { email } }),
      remove: () => core.data<EmailStatusDto>({ method: "DELETE", path: "/me/email" }),
    },
    removePushToken: (token: string) => core.request<void>({ method: "DELETE", path: `/me/push-tokens/${encodeURIComponent(token)}` }),
    deleteAccount: async () => {
      await core.request<void>({ method: "POST", path: "/me/delete", body: { confirm: true } });
      await core.clearTokens();
    },
  };
}
