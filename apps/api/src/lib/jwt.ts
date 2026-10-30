import { SignJWT, errors as joseErrors, jwtVerify } from "jose";
import { AppError } from "./errors";

export interface AccessTokenClaims {
  sub: string;
  sid: string;
  pa: boolean;
}

export interface JwtSigner {
  sign(claims: AccessTokenClaims): Promise<string>;
  verify(token: string): Promise<AccessTokenClaims>;
}

export function createJwtSigner(secret: string, ttlSec: number): JwtSigner {
  const key = new TextEncoder().encode(secret);
  return {
    async sign(claims) {
      return new SignJWT({ sid: claims.sid, pa: claims.pa })
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setSubject(claims.sub)
        .setIssuedAt()
        .setExpirationTime(`${ttlSec}s`)
        .sign(key);
    },
    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
        if (typeof payload.sub !== "string" || typeof payload.sid !== "string") {
          throw AppError.unauthenticated("Invalid token");
        }
        return { sub: payload.sub, sid: payload.sid, pa: payload.pa === true };
      } catch (err) {
        if (err instanceof AppError) throw err;
        if (err instanceof joseErrors.JWTExpired) {
          throw new AppError(401, "TOKEN_EXPIRED", "Access token expired");
        }
        throw AppError.unauthenticated("Invalid token");
      }
    },
  };
}
