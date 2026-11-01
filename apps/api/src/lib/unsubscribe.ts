import { createHmac, timingSafeEqual } from "node:crypto";
import type { Config } from "../config/env";

export const UNSUBSCRIBE_SCOPES = ["digest", "announcements"] as const;
export type UnsubscribeScope = (typeof UNSUBSCRIBE_SCOPES)[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A key just for unsubscribe links, derived from JWT_SECRET so no new secret is needed. */
function signingKey(config: Pick<Config, "JWT_SECRET">): Buffer {
  return createHmac("sha256", config.JWT_SECRET).update("illuminize/unsubscribe/v1").digest();
}

function mac(config: Pick<Config, "JWT_SECRET">, body: string): string {
  return createHmac("sha256", signingKey(config)).update(body).digest("base64url").slice(0, 32);
}

/**
 * A link token that turns off one kind of email for one membership. It never expires (old emails keep working) and
 * grants nothing else, so it is safe in a URL.
 */
export function createUnsubscribeToken(config: Pick<Config, "JWT_SECRET">, membershipId: string, scope: UnsubscribeScope): string {
  const body = `${membershipId}.${scope}`;
  return `${Buffer.from(body).toString("base64url")}.${mac(config, body)}`;
}

export function verifyUnsubscribeToken(config: Pick<Config, "JWT_SECRET">, token: string): { membershipId: string; scope: UnsubscribeScope } | null {
  const [encoded, sig, ...rest] = token.split(".");
  if (!encoded || !sig || rest.length) return null;
  const body = Buffer.from(encoded, "base64url").toString("utf8");
  const expected = Buffer.from(mac(config, body));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const [membershipId, scope] = body.split(".");
  if (!membershipId || !UUID_RE.test(membershipId) || !(UNSUBSCRIBE_SCOPES as readonly string[]).includes(scope ?? "")) return null;
  return { membershipId, scope: scope as UnsubscribeScope };
}

/**
 * The footer link (a web page that confirms) and the RFC 8058 one-click headers (a POST straight to the API, which
 * mail providers send when the member clicks "Unsubscribe" in their mail app).
 */
export function unsubscribeLinks(config: Pick<Config, "JWT_SECRET" | "PUBLIC_BASE_URL" | "webAppUrl">, membershipId: string, scope: UnsubscribeScope) {
  const token = encodeURIComponent(createUnsubscribeToken(config, membershipId, scope));
  const oneClick = `${config.PUBLIC_BASE_URL.replace(/\/+$/, "")}/api/v1/unsubscribe?token=${token}`;
  return {
    page: `${config.webAppUrl ?? ""}/unsubscribe?token=${token}`,
    headers: { "List-Unsubscribe": `<${oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  };
}
