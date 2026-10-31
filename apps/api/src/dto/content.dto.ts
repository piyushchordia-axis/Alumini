import type {
  AdminReportDto,
  CommentDto,
  ContentPreviewDto,
  EventDto,
  FundingDto,
  JobDto,
  JobSeekerDto,
  ModerationItemDto,
  PostDto,
  ReactionEntryDto,
  ReportDto,
} from "@illuminize/shared";
import type { EventWithAuthor, RsvpRow } from "../repositories/events.repo";
import type { FundingWithAuthor } from "../repositories/funding.repo";
import type { JobSeekerRow, JobWithAuthor } from "../repositories/jobs.repo";
import type { ModerationItemRow } from "../repositories/moderation.repo";
import type { CommentRow, PostWithAuthor, ReactionRow } from "../repositories/posts.repo";
import type { ReportRow } from "../repositories/reports.repo";
import type { MembershipRow } from "../types/request";
import { toMemberCardDto } from "./membership.dto";

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/** Who is looking at a piece of content: decides `isMine` and whether the admin's moderation note is included. */
export interface Viewer {
  membershipId: string | null;
  isAdmin: boolean;
}

/** The moderation note is between the admins and the author; other members never receive it. */
const noteFor = (note: string | null, authorId: string, viewer: Viewer | null) => (viewer && (viewer.isAdmin || viewer.membershipId === authorId) ? note : null);

export function toJobDto({ job, author }: JobWithAuthor, viewer: Viewer | null): JobDto {
  return {
    id: job.id,
    title: job.title,
    companyName: job.companyName,
    location: job.location,
    isRemote: job.isRemote,
    jobType: job.jobType,
    description: job.description,
    applyUrl: job.applyUrl,
    contactEmail: job.contactEmail,
    contactPhone: job.contactPhone,
    salaryRange: job.salaryRange,
    isClosed: job.isClosed,
    expiresAt: iso(job.expiresAt),
    moderationStatus: job.moderationStatus,
    moderationNote: noteFor(job.moderationNote, author.id, viewer),
    moderatedAt: iso(job.moderatedAt),
    author: toMemberCardDto(author),
    isMine: author.id === viewer?.membershipId,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

export function toJobSeekerDto(seeker: JobSeekerRow, member: MembershipRow): JobSeekerDto {
  return {
    member: toMemberCardDto(member, seeker.isActive),
    note: seeker.note,
    preferredRoles: seeker.preferredRoles,
    preferredLocations: seeker.preferredLocations,
    isActive: seeker.isActive,
    updatedAt: seeker.updatedAt.toISOString(),
  };
}

export function toFundingDto({ listing, author }: FundingWithAuthor, viewer: Viewer | null): FundingDto {
  return {
    id: listing.id,
    kind: listing.kind,
    title: listing.title,
    stage: listing.stage,
    amountMinMinor: listing.amountMinMinor,
    amountMaxMinor: listing.amountMaxMinor,
    currency: listing.currency,
    pitch: listing.pitch,
    sectors: listing.sectors,
    websiteUrl: listing.websiteUrl,
    contactEmail: listing.contactEmail,
    contactPhone: listing.contactPhone,
    isClosed: listing.isClosed,
    moderationStatus: listing.moderationStatus,
    moderationNote: noteFor(listing.moderationNote, author.id, viewer),
    moderatedAt: iso(listing.moderatedAt),
    author: toMemberCardDto(author),
    isMine: author.id === viewer?.membershipId,
    createdAt: listing.createdAt.toISOString(),
    updatedAt: listing.updatedAt.toISOString(),
  };
}

export function toPostDto({ post, author, myReaction }: PostWithAuthor, viewer: Viewer | null): PostDto {
  return {
    id: post.id,
    body: post.body,
    imageUrls: post.imageUrls,
    commentCount: post.commentCount,
    reactionCount: post.reactionCount,
    myReaction: myReaction ?? null,
    isPinned: post.isPinned,
    moderationStatus: post.moderationStatus,
    moderationNote: noteFor(post.moderationNote, author.id, viewer),
    moderatedAt: iso(post.moderatedAt),
    author: toMemberCardDto(author),
    isMine: author.id === viewer?.membershipId,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
  };
}

export function toCommentDto(comment: CommentRow, author: MembershipRow, viewerMembershipId: string | null): CommentDto {
  return {
    id: comment.id,
    postId: comment.postId,
    body: comment.body,
    author: toMemberCardDto(author),
    isMine: author.id === viewerMembershipId,
    moderationStatus: comment.moderationStatus,
    createdAt: comment.createdAt.toISOString(),
  };
}

export function toReactionEntryDto(reaction: ReactionRow, member: MembershipRow): ReactionEntryDto {
  return { member: toMemberCardDto(member), type: reaction.type, createdAt: reaction.createdAt.toISOString() };
}

export function toEventDto({ event, author, myRsvp }: EventWithAuthor, viewer: Viewer | null, attendeePreview?: MembershipRow[]): EventDto {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    kind: event.kind,
    city: event.city,
    venueName: event.venueName,
    address: event.address,
    startAt: event.startAt.toISOString(),
    endAt: iso(event.endAt),
    timezone: event.timezone,
    maxAttendees: event.maxAttendees,
    coverImageUrl: event.coverImageUrl,
    isCancelled: event.isCancelled,
    yesCount: event.yesCount,
    maybeCount: event.maybeCount,
    myRsvp: myRsvp ?? null,
    moderationStatus: event.moderationStatus,
    moderationNote: noteFor(event.moderationNote, author.id, viewer),
    moderatedAt: iso(event.moderatedAt),
    author: toMemberCardDto(author),
    isMine: author.id === viewer?.membershipId,
    ...(attendeePreview ? { attendeePreview: attendeePreview.map((m) => toMemberCardDto(m)) } : {}),
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
  };
}

export function rsvpStatusOf(r: RsvpRow | undefined): RsvpRow["status"] | null {
  return r?.status ?? null;
}

export function toReportDto(r: ReportRow): ReportDto {
  return {
    id: r.id,
    contentType: r.contentType,
    contentId: r.contentId,
    reason: r.reason,
    details: r.details,
    status: r.status,
    resolutionNote: r.resolutionNote,
    createdAt: r.createdAt.toISOString(),
    resolvedAt: iso(r.resolvedAt),
  };
}

export function toContentPreviewDto(item: ModerationItemRow | null): ContentPreviewDto | null {
  if (!item) return null;
  return {
    title: item.title,
    excerpt: item.excerpt ? item.excerpt.slice(0, 300) : null,
    moderationStatus: item.moderationStatus,
    authorMembershipId: item.authorMembershipId,
  };
}

export function toAdminReportDto(r: ReportRow, reporter: MembershipRow, content: ModerationItemRow | null): AdminReportDto {
  return { ...toReportDto(r), reporter: toMemberCardDto(reporter), content: toContentPreviewDto(content) };
}

export function toModerationItemDto(item: ModerationItemRow, author: MembershipRow, reportCount: number): ModerationItemDto {
  return {
    contentType: item.contentType,
    id: item.id,
    title: item.title,
    excerpt: item.excerpt ? item.excerpt.slice(0, 300) : null,
    author: toMemberCardDto(author),
    moderationStatus: item.moderationStatus,
    moderatedAt: iso(item.moderatedAt),
    createdAt: item.createdAt.toISOString(),
    reportCount,
    isPinned: item.isPinned,
  };
}
