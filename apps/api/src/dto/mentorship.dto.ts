import type { MentorCardDto, MentorDto, MentorProfileDto, MentorshipBox, MentorshipDto, MentorshipLinkDto } from "@illuminize/shared";
import type { MentorProfileRow, MentorshipRow } from "../repositories/mentorship.repo";
import type { MembershipRow } from "../types/request";
import { toMemberCardDto } from "./membership.dto";

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function toMentorProfileDto(p: MentorProfileRow): MentorProfileDto {
  return {
    areas: p.areas,
    availability: p.availability,
    availabilityNote: p.availabilityNote,
    note: p.note,
    isActive: p.isActive,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export function toMentorCardDto(p: MentorProfileRow, member: MembershipRow): MentorCardDto {
  return { member: toMemberCardDto(member), areas: p.areas, availability: p.availability };
}

/** Its status and chat only: `suppressed` must never shape what the mentee is told. */
export function toMentorshipLinkDto(m: MentorshipRow): MentorshipLinkDto {
  return { id: m.id, status: m.status === "ACCEPTED" ? "ACCEPTED" : "REQUESTED", conversationId: m.conversationId };
}

export function toMentorDto(p: MentorProfileRow, member: MembershipRow, viewerMembershipId: string, myRequest: MentorshipRow | undefined): MentorDto {
  return {
    ...toMentorCardDto(p, member),
    availabilityNote: p.availabilityNote,
    note: p.note,
    isMe: member.id === viewerMembershipId,
    myRequest: myRequest ? toMentorshipLinkDto(myRequest) : null,
  };
}

/**
 * A mentorship as `viewerMembershipId` sees it. Nothing here reads `suppressed`, which is what keeps a request its mentor
 * never saw reading, to its sender, exactly like one waiting for an answer. `reportedByViewer` says the viewer has reported
 * its note already. A mentor can report the note of any request that never became a mentorship, including one its sender
 * withdrew, which they can still read, so withdrawing can't take a note out of reach of a report.
 */
export function toMentorshipDto(m: MentorshipRow, other: MembershipRow | null, viewerMembershipId: string, reportedByViewer = false): MentorshipDto {
  const box: MentorshipBox = m.mentorMembershipId === viewerMembershipId ? "received" : "sent";
  const waiting = m.status === "REQUESTED";
  return {
    id: m.id,
    box,
    status: m.status,
    member: other ? toMemberCardDto(other) : null,
    note: m.note,
    conversationId: m.conversationId,
    endedByMe: m.status === "ENDED" && m.endedByMembershipId === viewerMembershipId,
    createdAt: m.createdAt.toISOString(),
    respondedAt: iso(m.respondedAt),
    acceptedAt: iso(m.acceptedAt),
    endedAt: iso(m.endedAt),
    canAccept: waiting && box === "received",
    canDecline: waiting && box === "received",
    canReport: box === "received" && !m.acceptedAt && !reportedByViewer,
    canWithdraw: waiting && box === "sent",
    canEnd: m.status === "ACCEPTED",
  };
}
