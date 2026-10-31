import { eq } from "drizzle-orm";
import request from "supertest";
import { events } from "../../src/db/schema";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTenant, memberSession } from "../helpers/factories";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();
const future = (days: number) => new Date(Date.now() + days * 86400000).toISOString();

const EVENT = {
  title: "Mumbai meetup",
  description: "Coffee and catch-up",
  kind: "CASUAL_MEETUP",
  city: "Mumbai",
  startAt: future(7),
  endAt: future(7.1),
  timezone: "Asia/Kolkata",
  maxAttendees: 2,
};

describe.skipIf(!dbAvailable)("events + RSVP", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  beforeEach(async () => {
    await ctx.truncateAll();
  });
  afterAll(async () => {
    await ctx.dispose();
  });
  const api = () => request(ctx.app);

  it("validates event input", async () => {
    const { tenant } = await createTenant(ctx);
    const host = await memberSession(ctx, tenant.id);
    const base = `/api/v1/t/${tenant.slug}/events`;
    expect((await api().post(base).set(host.headers).send({ ...EVENT, startAt: future(-2) })).status).toBe(400);
    expect((await api().post(base).set(host.headers).send({ ...EVENT, endAt: future(6) })).status).toBe(400);
    expect((await api().post(base).set(host.headers).send({ ...EVENT, timezone: "Mars/Olympus" })).status).toBe(400);
    expect((await api().post(base).set(host.headers).send({ ...EVENT, maxAttendees: 0 })).status).toBe(400);
  });

  it("handles RSVPs, capacity, attendee lists, notifications and cancellation", async () => {
    const { tenant } = await createTenant(ctx);
    const base = `/api/v1/t/${tenant.slug}`;
    const host = await memberSession(ctx, tenant.id, { fullName: "Host" });
    const a = await memberSession(ctx, tenant.id, { fullName: "Guest A" });
    const b = await memberSession(ctx, tenant.id, { fullName: "Guest B" });
    const c = await memberSession(ctx, tenant.id, { fullName: "Guest C" });

    const created = await api().post(`${base}/events`).set(host.headers).send(EVENT);
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    expect(created.body.data).toMatchObject({ yesCount: 0, maybeCount: 0, myRsvp: null, isCancelled: false, timezone: "Asia/Kolkata" });

    expect((await api().put(`${base}/events/${id}/rsvp`).set(a.headers).send({ status: "YES" })).body.data).toEqual({ myRsvp: "YES", yesCount: 1, maybeCount: 0 });
    expect((await api().put(`${base}/events/${id}/rsvp`).set(b.headers).send({ status: "YES" })).body.data).toEqual({ myRsvp: "YES", yesCount: 2, maybeCount: 0 });
    const full = await api().put(`${base}/events/${id}/rsvp`).set(c.headers).send({ status: "YES" });
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe("EVENT_FULL");
    expect((await api().put(`${base}/events/${id}/rsvp`).set(c.headers).send({ status: "MAYBE" })).body.data).toEqual({ myRsvp: "MAYBE", yesCount: 2, maybeCount: 1 });
    // an existing YES can re-confirm even at capacity
    expect((await api().put(`${base}/events/${id}/rsvp`).set(a.headers).send({ status: "YES" })).status).toBe(200);

    const detail = await api().get(`${base}/events/${id}`).set(c.headers);
    expect(detail.body.data).toMatchObject({ yesCount: 2, maybeCount: 1, myRsvp: "MAYBE" });
    expect(detail.body.data.attendeePreview.map((m: { fullName: string }) => m.fullName)).toEqual(["Guest A", "Guest B"]);
    const attendees = await api().get(`${base}/events/${id}/attendees?status=MAYBE`).set(host.headers);
    expect(attendees.body.data.map((m: { fullName: string }) => m.fullName)).toEqual(["Guest C"]);

    const hostNotifs = await api().get(`${base}/notifications`).set(host.headers);
    expect(hostNotifs.body.data.filter((n: { type: string }) => n.type === "EVENT_RSVP")).toHaveLength(2);

    expect((await api().delete(`${base}/events/${id}/rsvp`).set(b.headers)).body.data).toEqual({ myRsvp: null, yesCount: 1, maybeCount: 1 });
    expect((await api().put(`${base}/events/${id}/rsvp`).set(c.headers).send({ status: "YES" })).status).toBe(200);

    const upcoming = await api().get(`${base}/events`).set(a.headers);
    expect(upcoming.body.data.map((e: { id: string }) => e.id)).toEqual([id]);
    expect((await api().get(`${base}/events?scope=past`).set(a.headers)).body.data).toHaveLength(0);
    expect((await api().get(`${base}/events?city=mumbai`).set(a.headers)).body.data).toHaveLength(1);

    expect((await api().post(`${base}/events/${id}/cancel`).set(a.headers).send({})).status).toBe(403);
    const cancelled = await api().post(`${base}/events/${id}/cancel`).set(host.headers).send({ reason: "Venue closed" });
    expect(cancelled.body.data.isCancelled).toBe(true);
    expect((await api().get(`${base}/events`).set(a.headers)).body.data).toHaveLength(0);
    expect((await api().get(`${base}/events?mine=true`).set(host.headers)).body.data).toHaveLength(1);
    const aNotifs = await api().get(`${base}/notifications`).set(a.headers);
    expect(aNotifs.body.data[0]).toMatchObject({ type: "EVENT_CANCELLED", body: "Reason: Venue closed" });
    expect((await api().put(`${base}/events/${id}/rsvp`).set(a.headers).send({ status: "YES" })).status).toBe(409);
  });

  it("lets the author edit and delete", async () => {
    const { tenant } = await createTenant(ctx);
    const host = await memberSession(ctx, tenant.id);
    const other = await memberSession(ctx, tenant.id);
    const base = `/api/v1/t/${tenant.slug}/events`;
    const created = await api().post(base).set(host.headers).send(EVENT);
    const id = created.body.data.id;
    expect((await api().patch(`${base}/${id}`).set(other.headers).send({ title: "Hijacked title" })).status).toBe(403);
    expect((await api().patch(`${base}/${id}`).set(host.headers).send({ endAt: future(6) })).status).toBe(400);
    const edited = await api().patch(`${base}/${id}`).set(host.headers).send({ title: "Mumbai meetup v2", maxAttendees: null });
    expect(edited.body.data).toMatchObject({ title: "Mumbai meetup v2", maxAttendees: null });
    expect((await api().delete(`${base}/${id}`).set(host.headers)).status).toBe(204);
  });
});

describe.skipIf(!dbAvailable)("event rules", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  beforeEach(async () => {
    await ctx.truncateAll();
  });
  afterAll(async () => {
    await ctx.dispose();
  });
  const api = () => request(ctx.app);

  it("keeps capacity above the current RSVPs and notifies attendees of time/place changes", async () => {
    const { tenant } = await createTenant(ctx);
    const base = `/api/v1/t/${tenant.slug}`;
    const host = await memberSession(ctx, tenant.id);
    const a = await memberSession(ctx, tenant.id);
    const b = await memberSession(ctx, tenant.id);
    const created = await api().post(`${base}/events`).set(host.headers).send({ ...EVENT, maxAttendees: 5 });
    const id = created.body.data.id;
    await api().put(`${base}/events/${id}/rsvp`).set(a.headers).send({ status: "YES" });
    await api().put(`${base}/events/${id}/rsvp`).set(b.headers).send({ status: "YES" });
    const tooSmall = await api().patch(`${base}/events/${id}`).set(host.headers).send({ maxAttendees: 1 });
    expect(tooSmall.status).toBe(400);
    expect(tooSmall.body.error.details[0].path).toBe("maxAttendees");

    const titleOnly = await api().patch(`${base}/events/${id}`).set(host.headers).send({ title: "Renamed meetup" });
    expect(titleOnly.status).toBe(200);
    expect((await api().get(`${base}/notifications`).set(a.headers)).body.data.some((n: { type: string }) => n.type === "EVENT_UPDATED")).toBe(false);

    const moved = await api().patch(`${base}/events/${id}`).set(host.headers).send({ venueName: "New cafe", startAt: future(8), endAt: future(8.1) });
    expect(moved.status).toBe(200);
    const notif = (await api().get(`${base}/notifications`).set(a.headers)).body.data.find((n: { type: string }) => n.type === "EVENT_UPDATED");
    expect(notif.body).toContain("time and place");
  });

  it("allows editing a past event's details but not moving it into another past time, and blocks RSVPs once over", async () => {
    const { tenant } = await createTenant(ctx);
    const base = `/api/v1/t/${tenant.slug}`;
    const host = await memberSession(ctx, tenant.id);
    const guest = await memberSession(ctx, tenant.id);
    const created = await api().post(`${base}/events`).set(host.headers).send(EVENT);
    const id = created.body.data.id;
    // Move the event into the past directly in the database.
    await ctx.db.update(events).set({ startAt: new Date(Date.now() - 3 * 86400000), endAt: new Date(Date.now() - 3 * 86400000 + 7200000) }).where(eq(events.id, id));

    expect((await api().patch(`${base}/events/${id}`).set(host.headers).send({ description: "Thanks for coming!" })).status).toBe(200);
    const backdated = await api().patch(`${base}/events/${id}`).set(host.headers).send({ startAt: new Date(Date.now() - 5 * 86400000).toISOString(), endAt: null });
    expect(backdated.status).toBe(400);
    const late = await api().put(`${base}/events/${id}/rsvp`).set(guest.headers).send({ status: "YES" });
    expect(late.status).toBe(409);
    expect(late.body.error.message).toMatch(/ended/);
  });

  it("notifies attendees when an upcoming event is deleted", async () => {
    const { tenant } = await createTenant(ctx);
    const base = `/api/v1/t/${tenant.slug}`;
    const host = await memberSession(ctx, tenant.id);
    const guest = await memberSession(ctx, tenant.id);
    const created = await api().post(`${base}/events`).set(host.headers).send(EVENT);
    await api().put(`${base}/events/${created.body.data.id}/rsvp`).set(guest.headers).send({ status: "MAYBE" });
    expect((await api().delete(`${base}/events/${created.body.data.id}`).set(host.headers)).status).toBe(204);
    const n = (await api().get(`${base}/notifications`).set(guest.headers)).body.data[0];
    expect(n).toMatchObject({ type: "EVENT_CANCELLED", body: "The organiser removed this gathering." });
  });
});
