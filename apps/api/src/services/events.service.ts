import type { AttendeesQuery, CursorPage, EventCreateInput, EventDto, EventListQuery, EventUpdateInput, MemberCardDto, RsvpStatus, RsvpSummaryDto } from "@illuminize/shared";
import type { AppContext } from "../context";
import { toEventDto } from "../dto/content.dto";
import { toMemberCardDto } from "../dto/membership.dto";
import { AppError } from "../lib/errors";
import {
  deleteEvent,
  deleteRsvp,
  findEventById,
  findEventWithAuthor,
  findRsvp,
  insertEvent,
  listAttendees,
  listEvents,
  listRsvpMembershipIds,
  recountRsvps,
  updateEvent,
  upsertRsvp,
} from "../repositories/events.repo";
import type { TenantContext } from "../types/request";
import { afterContentWrite, assertAuthor, assertAuthorOrAdmin, assertCanView, initialStatusFor, statusAfterEdit, type ContentActor } from "./content.common";
import { notify } from "./notifications/notification.service";

function eventColumns(input: EventCreateInput | EventUpdateInput) {
  const out: Record<string, unknown> = {};
  for (const key of ["title", "description", "kind", "city", "venueName", "address", "timezone", "maxAttendees", "coverImageUrl"] as const) {
    if (input[key] !== undefined) out[key] = input[key];
  }
  if (input.startAt !== undefined) out.startAt = new Date(input.startAt);
  if (input.endAt !== undefined) out.endAt = input.endAt ? new Date(input.endAt) : null;
  return out;
}

export async function listTenantEvents(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, query: EventListQuery): Promise<CursorPage<EventDto>> {
  const page = await listEvents(ctx.db, tenantCtx.tenant.id, query, actor.membership.id);
  return { data: page.data.map((r) => toEventDto(r, actor.membership.id)), nextCursor: page.nextCursor };
}

export async function createEvent(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, input: EventCreateInput): Promise<EventDto> {
  const status = initialStatusFor(tenantCtx, actor, "EVENT");
  const row = await insertEvent(ctx.db, {
    tenantId: tenantCtx.tenant.id,
    authorMembershipId: actor.membership.id,
    title: input.title,
    description: input.description,
    kind: input.kind,
    city: input.city,
    startAt: new Date(input.startAt),
    timezone: input.timezone,
    ...eventColumns(input),
    moderationStatus: status,
    moderatedAt: status === "APPROVED" ? new Date() : null,
  });
  await afterContentWrite(ctx, tenantCtx, actor, { contentType: "EVENT", id: row.id, title: row.title, status, action: "create" });
  return toEventDto({ event: row, author: actor.membership, myRsvp: null }, actor.membership.id);
}

async function loadEvent(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string) {
  const found = await findEventWithAuthor(ctx.db, tenantCtx.tenant.id, id, actor.membership.id);
  if (!found) throw AppError.notFound("Event not found");
  return found;
}

export async function getEvent(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string): Promise<EventDto> {
  const found = await loadEvent(ctx, tenantCtx, actor, id);
  assertCanView(actor, found.event.moderationStatus, found.event.authorMembershipId, "Event");
  const preview = await listAttendees(ctx.db, id, { limit: 5, status: "YES" });
  return toEventDto(found, actor.membership.id, preview.data.map((r) => r.member));
}

export async function getEventForAdmin(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string): Promise<EventDto> {
  return toEventDto(await loadEvent(ctx, tenantCtx, actor, id), actor.membership.id);
}

export async function updateEventListing(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string, input: EventUpdateInput): Promise<EventDto> {
  const found = await loadEvent(ctx, tenantCtx, actor, id);
  assertAuthor(actor, found.event.authorMembershipId);
  const nextStart = input.startAt ? new Date(input.startAt) : found.event.startAt;
  const nextEnd = input.endAt === undefined ? found.event.endAt : input.endAt ? new Date(input.endAt) : null;
  if (nextEnd && nextEnd <= nextStart) throw AppError.badRequest("End time must be after the start time", [{ path: "endAt", message: "Must be after startAt" }]);
  const status = statusAfterEdit(tenantCtx, actor, found.event.moderationStatus);
  const row = (await updateEvent(ctx.db, tenantCtx.tenant.id, id, {
    ...eventColumns(input),
    moderationStatus: status,
    moderationNote: status === found.event.moderationStatus ? found.event.moderationNote : null,
  }))!;
  await afterContentWrite(ctx, tenantCtx, actor, { contentType: "EVENT", id, title: row.title, status, action: "update" });
  return toEventDto({ event: row, author: found.author, myRsvp: found.myRsvp }, actor.membership.id);
}

export async function removeEvent(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string): Promise<void> {
  const found = await loadEvent(ctx, tenantCtx, actor, id);
  assertAuthor(actor, found.event.authorMembershipId);
  await deleteEvent(ctx.db, tenantCtx.tenant.id, id);
  await afterContentWrite(ctx, tenantCtx, actor, { contentType: "EVENT", id, title: found.event.title, status: found.event.moderationStatus, action: "delete" });
}

export async function cancelEvent(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string, reason?: string | null): Promise<EventDto> {
  const found = await loadEvent(ctx, tenantCtx, actor, id);
  assertAuthorOrAdmin(actor, found.event.authorMembershipId);
  if (found.event.isCancelled) return toEventDto(found, actor.membership.id);
  const row = (await updateEvent(ctx.db, tenantCtx.tenant.id, id, { isCancelled: true }))!;
  await afterContentWrite(ctx, tenantCtx, actor, { contentType: "EVENT", id, title: row.title, status: row.moderationStatus, action: "cancel" });
  const attendees = await listRsvpMembershipIds(ctx.db, id, ["YES", "MAYBE"]);
  await notify(ctx, {
    tenantId: tenantCtx.tenant.id,
    recipientMembershipIds: attendees.filter((m) => m !== actor.membership.id),
    type: "EVENT_CANCELLED",
    title: `Cancelled: ${row.title}`,
    body: reason ? `Reason: ${reason}` : "The organiser cancelled this gathering.",
    data: { eventId: id, contentType: "EVENT", contentId: id },
  });
  return toEventDto({ event: row, author: found.author, myRsvp: found.myRsvp }, actor.membership.id);
}

// ---- RSVP ----

export async function setRsvp(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string, status: RsvpStatus): Promise<RsvpSummaryDto> {
  const tenantId = tenantCtx.tenant.id;
  const result = await ctx.db.transaction(async (tx) => {
    const event = await findEventById(tx, tenantId, id, true);
    if (!event) throw AppError.notFound("Event not found");
    assertCanView(actor, event.moderationStatus, event.authorMembershipId, "Event");
    if (event.moderationStatus !== "APPROVED") throw AppError.forbidden("This event is not published yet");
    if (event.isCancelled) throw AppError.conflict("This event has been cancelled");
    const existing = await findRsvp(tx, id, actor.membership.id);
    if (status === "YES" && existing?.status !== "YES" && event.maxAttendees && event.yesCount >= event.maxAttendees) {
      throw AppError.conflict("This event is full", "EVENT_FULL");
    }
    await upsertRsvp(tx, { tenantId, eventId: id, membershipId: actor.membership.id, status });
    const counts = await recountRsvps(tx, id);
    return { counts, event, isNewYes: status === "YES" && existing?.status !== "YES" };
  });
  if (result.isNewYes && result.event.authorMembershipId !== actor.membership.id) {
    await notify(ctx, {
      tenantId,
      recipientMembershipIds: [result.event.authorMembershipId],
      type: "EVENT_RSVP",
      title: `${actor.membership.fullName} is coming to ${result.event.title}`,
      data: { eventId: id, contentType: "EVENT", contentId: id, membershipId: actor.membership.id },
    });
  }
  return { myRsvp: status, ...result.counts };
}

export async function clearRsvp(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string): Promise<RsvpSummaryDto> {
  const found = await loadEvent(ctx, tenantCtx, actor, id);
  assertCanView(actor, found.event.moderationStatus, found.event.authorMembershipId, "Event");
  await deleteRsvp(ctx.db, id, actor.membership.id);
  const counts = await recountRsvps(ctx.db, id);
  return { myRsvp: null, ...counts };
}

export async function listEventAttendees(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string, query: AttendeesQuery): Promise<CursorPage<MemberCardDto>> {
  const found = await loadEvent(ctx, tenantCtx, actor, id);
  assertCanView(actor, found.event.moderationStatus, found.event.authorMembershipId, "Event");
  const page = await listAttendees(ctx.db, id, query);
  return { data: page.data.map((r) => toMemberCardDto(r.member)), nextCursor: page.nextCursor };
}
