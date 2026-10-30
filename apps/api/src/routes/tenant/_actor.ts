import type { Request } from "express";
import type { ContentActor } from "../../services/content.common";

/** Builds the content actor for a request that passed `requireMember` (membership is guaranteed). */
export function contentActor(req: Request): ContentActor {
  return { ...req.auth!, membership: req.membership!, ip: req.ip };
}

export function adminActor(req: Request) {
  return { ...req.auth!, membershipId: req.membership?.id ?? null, ip: req.ip };
}
