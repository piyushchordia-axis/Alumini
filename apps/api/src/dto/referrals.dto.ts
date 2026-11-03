import type { JobReferralLinkDto, ReferralBox, ReferralDto } from "@illuminize/shared";
import type { ReferralRow } from "../repositories/referrals.repo";
import type { MembershipRow } from "../types/request";
import { toMemberCardDto } from "./membership.dto";

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** Its status, as its sender sees it: nothing here reads `suppressed`. */
export function toJobReferralLinkDto(r: ReferralRow): JobReferralLinkDto {
  return { id: r.id, status: r.status, createdAt: r.createdAt.toISOString(), conversationId: r.conversationId };
}

/**
 * A referral request as `viewerMembershipId` sees it. Nothing here reads `suppressed`, which is what keeps a request its
 * poster never saw reading, to its sender, exactly like one waiting for an answer. `jobAvailable` says whether the viewer
 * can open the job's page now. `reportedByViewer` says the viewer has reported its note already. A poster can report the
 * note of any request that was never accepted, including one its sender withdrew or that closed with the job, which they
 * can still read, so neither can take a note out of reach of a report.
 */
export function toReferralDto(r: ReferralRow, other: MembershipRow | null, viewerMembershipId: string, jobAvailable: boolean, reportedByViewer = false): ReferralDto {
  const box: ReferralBox = r.posterMembershipId === viewerMembershipId ? "received" : "sent";
  const isWaiting = r.status === "REQUESTED";
  return {
    id: r.id,
    box,
    status: r.status,
    job: { id: r.jobId, title: r.jobTitle, companyName: r.jobCompany, available: !!r.jobId && jobAvailable },
    member: other ? toMemberCardDto(other) : null,
    note: r.note,
    conversationId: r.conversationId,
    createdAt: r.createdAt.toISOString(),
    respondedAt: iso(r.respondedAt),
    acceptedAt: iso(r.acceptedAt),
    closedAt: iso(r.closedAt),
    canAccept: isWaiting && box === "received",
    canDecline: isWaiting && box === "received",
    canReport: box === "received" && !r.acceptedAt && !reportedByViewer,
    canWithdraw: isWaiting && box === "sent",
  };
}
