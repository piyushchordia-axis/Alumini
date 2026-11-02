import type { Request } from "express";
import type { ChatReportViewer } from "../../services/chat/adminReports.service";
import type { ContentActor } from "../../services/content.common";

/** Builds the content actor for a request that passed `requireMember` (membership is guaranteed). */
export function contentActor(req: Request): ContentActor {
  return { ...req.auth!, membership: req.membership!, ip: req.ip };
}

export function adminActor(req: Request) {
  return { ...req.auth!, membershipId: req.membership?.id ?? null, ip: req.ip };
}

export function chatReportViewer(req: Request): ChatReportViewer {
  return { ...req.auth!, membership: req.membership ?? null, ip: req.ip };
}
