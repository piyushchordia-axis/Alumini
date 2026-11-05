import { inFieldOrder, moveId, type ProfileFieldDto } from "@illuminize/shared";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { memberships } from "../../src/db/schema";
import { PROFILE, createTenant, createUser, loginAs, auth, memberSession } from "../helpers/factories";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();

describe.skipIf(!dbAvailable)("custom profile fields", () => {
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

  async function setup() {
    const { tenant } = await createTenant(ctx, { memberApprovalMode: "AUTO_APPROVE" });
    const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
    const base = `/api/v1/t/${tenant.slug}`;
    const create = (body: Record<string, unknown>) => api().post(`${base}/admin/profile-fields`).set(admin.headers).send(body);
    return { tenant, admin, base, create };
  }

  async function standardFields(create: (b: Record<string, unknown>) => request.Test) {
    const house = await create({ key: "house", label: "House", type: "SELECT", options: [{ value: "blue", label: "Blue House" }, { value: "red", label: "Red House" }], required: true, filterable: true });
    const sports = await create({ key: "sports", label: "Sports", type: "MULTI_SELECT", options: [{ value: "cricket", label: "Cricket" }, { value: "chess", label: "Chess" }], filterable: true });
    const roll = await create({ key: "roll_no", label: "Roll number", type: "TEXT", visibility: "ADMINS" });
    const verified = await create({ key: "verified", label: "Alumni card verified", type: "BOOLEAN", visibility: "ADMINS", memberEditable: false });
    const hostel = await create({ key: "hostel", label: "Hostel", type: "BOOLEAN", filterable: true });
    for (const r of [house, sports, roll, verified, hostel]) expect(r.status).toBe(201);
    return { house: house.body.data, sports: sports.body.data, roll: roll.body.data, verified: verified.body.data, hostel: hostel.body.data };
  }

  it("lets admins define, edit, reorder and archive fields, with validation", async () => {
    const { base, admin, create, tenant } = await setup();
    const f = await standardFields(create);
    expect((await create({ key: "house", label: "Dup", type: "TEXT" })).status).toBe(409);
    expect((await create({ key: "Bad Key", label: "x", type: "TEXT" })).status).toBe(400);
    const noOptions = await create({ key: "batch_section", label: "Section", type: "SELECT" });
    expect(noOptions.status).toBe(400);
    expect((await create({ key: "notes", label: "Notes", type: "TEXT", filterable: true })).status).toBe(400);

    const member = await memberSession(ctx, tenant.id);
    expect((await api().post(`${base}/admin/profile-fields`).set(member.headers).send({ key: "x1", label: "x", type: "TEXT" })).status).toBe(403);

    const renamed = await api().patch(`${base}/admin/profile-fields/${f.house.id}`).set(admin.headers).send({ label: "School house", key: "renamed" });
    expect(renamed.body.data).toMatchObject({ key: "house", label: "School house" });

    const order = [f.hostel.id, f.house.id];
    const reordered = await api().post(`${base}/admin/profile-fields/reorder`).set(admin.headers).send({ ids: order });
    expect(reordered.body.data.slice(0, 2).map((x: { key: string }) => x.key)).toEqual(["hostel", "house"]);

    const archived = await api().post(`${base}/admin/profile-fields/${f.sports.id}/archive`).set(admin.headers);
    expect(archived.body.data.archivedAt).toEqual(expect.any(String));
    const active = await api().get(`${base}/admin/profile-fields`).set(admin.headers);
    expect(active.body.data.map((x: { key: string }) => x.key)).not.toContain("sports");
    const all = await api().get(`${base}/admin/profile-fields?includeArchived=true`).set(admin.headers);
    expect(all.body.data.map((x: { key: string }) => x.key)).toContain("sports");
    expect((await api().post(`${base}/admin/profile-fields/${f.sports.id}/restore`).set(admin.headers)).body.data.archivedAt).toBeNull();
  });

  it("stores a move in the order the consoles show at once (inFieldOrder), archived fields included", async () => {
    const { base, admin, create } = await setup();
    const f = await standardFields(create);
    expect((await api().post(`${base}/admin/profile-fields/${f.sports.id}/archive`).set(admin.headers)).status).toBe(200);
    const listAll = async () => (await api().get(`${base}/admin/profile-fields?includeArchived=true`).set(admin.headers)).body.data as ProfileFieldDto[];
    const before = await listAll();
    const active = before.filter((x) => !x.archivedAt).map((x) => x.id);
    // Hostel, the last active field, up one place, as the arrows send it.
    const ids = moveId(active, active.length - 1, -1);
    const shown = inFieldOrder(before, ids).map((x) => x.key);
    expect(shown).toEqual(["house", "roll_no", "hostel", "verified", "sports"]);
    const stored = await api().post(`${base}/admin/profile-fields/reorder`).set(admin.headers).send({ ids });
    expect(stored.status).toBe(200);
    expect(stored.body.data.map((x: ProfileFieldDto) => x.key)).toEqual(shown);
    expect((await listAll()).map((x) => x.key)).toEqual(shown);
  });

  it("caps active fields at 30", async () => {
    const { create } = await setup();
    for (let i = 0; i < 30; i++) expect((await create({ key: `q${i}`, label: `Q${i}`, type: "TEXT" })).status).toBe(201);
    expect((await create({ key: "q30", label: "One too many", type: "TEXT" })).status).toBe(409);
  });

  it("asks members the right questions, requires required ones at registration, and stores typed answers", async () => {
    const { base, create } = await setup();
    await standardFields(create);
    const user = await createUser(ctx);
    const { accessToken } = await loginAs(ctx, user.phoneE164);
    const h = auth(accessToken);

    const visible = await api().get(`${base}/profile-fields`).set(h);
    expect(visible.status).toBe(200);
    expect(visible.body.data.map((x: { key: string }) => x.key)).toEqual(["house", "sports", "roll_no", "hostel"]); // not the admin-managed note

    const missing = await api().post(`${base}/memberships`).set(h).send({ ...PROFILE, fields: { sports: ["chess"] } });
    expect(missing.status).toBe(400);
    expect(missing.body.error.details).toEqual([{ path: "fields.house", message: "This is required" }]);
    const badChoice = await api().post(`${base}/memberships`).set(h).send({ ...PROFILE, fields: { house: "green" } });
    expect(badChoice.body.error.details).toEqual([{ path: "fields.house", message: "Choose one of the options" }]);
    const sneaky = await api().post(`${base}/memberships`).set(h).send({ ...PROFILE, fields: { house: "blue", verified: true } });
    expect(sneaky.body.error.details).toEqual([{ path: "fields.verified", message: "Unknown field" }]);
    // Nothing was stored by the failed attempts (registration is one transaction).
    expect(await ctx.db.select().from(memberships)).toHaveLength(1); // just the admin

    const ok = await api().post(`${base}/memberships`).set(h).send({ ...PROFILE, fields: { house: "blue", sports: ["chess", "cricket"], roll_no: "EE-042", hostel: true } });
    expect(ok.status).toBe(201);
    expect(ok.body.data.fields).toEqual([
      { key: "house", label: "House", type: "SELECT", visibility: "MEMBERS", value: "blue", display: "Blue House" },
      { key: "sports", label: "Sports", type: "MULTI_SELECT", visibility: "MEMBERS", value: ["chess", "cricket"], display: "Chess, Cricket" },
      { key: "roll_no", label: "Roll number", type: "TEXT", visibility: "ADMINS", value: "EE-042", display: "EE-042" },
      { key: "hostel", label: "Hostel", type: "BOOLEAN", visibility: "MEMBERS", value: true, display: "Yes" },
    ]);

    // Profile edits: other changes work without resending answers; clearing a required answer doesn't.
    expect((await api().patch(`${base}/memberships/me`).set(h).send({ city: "Pune" })).status).toBe(200);
    const cleared = await api().patch(`${base}/memberships/me`).set(h).send({ fields: { house: null } });
    expect(cleared.body.error.details).toEqual([{ path: "fields.house", message: "This is required" }]);
    const changed = await api().patch(`${base}/memberships/me`).set(h).send({ fields: { sports: [], house: "red" } });
    expect(changed.body.data.fields.map((x: { key: string }) => x.key)).toEqual(["house", "roll_no", "hostel"]);
    expect((await api().get(`${base}/memberships/me`).set(h)).body.data.fields[0]).toMatchObject({ key: "house", value: "red" });
  });

  it("shows other members only members-visible answers, admins everything, and only admins set admin-managed fields", async () => {
    const { base, admin, create, tenant } = await setup();
    await standardFields(create);
    const asha = await memberSession(ctx, tenant.id);
    const other = await memberSession(ctx, tenant.id);
    // "true" and "007" must stay text (a plain jsonb column would hand them back as a boolean and a number).
    const saved = await api().patch(`${base}/memberships/me`).set(asha.headers).send({ fields: { house: "blue", roll_no: "007" } });
    expect(saved.body.data.fields[1]).toMatchObject({ key: "roll_no", value: "007" });
    await api().patch(`${base}/memberships/me`).set(asha.headers).send({ fields: { roll_no: "true" } });
    expect((await api().get(`${base}/memberships/me`).set(asha.headers)).body.data.fields[1].value).toBe("true");
    expect((await api().patch(`${base}/memberships/me`).set(asha.headers).send({ fields: { verified: true } })).status).toBe(400);
    const byAdmin = await api().patch(`${base}/admin/members/${asha.membership.id}/profile`).set(admin.headers).send({ fields: { verified: true } });
    expect(byAdmin.status).toBe(200);
    expect(byAdmin.body.data.fields.map((x: { key: string }) => x.key)).toEqual(["house", "roll_no", "verified"]);

    const seen = await api().get(`${base}/directory/${asha.membership.id}`).set(other.headers);
    expect(seen.body.data.fields).toEqual([{ key: "house", label: "House", type: "SELECT", visibility: "MEMBERS", value: "blue", display: "Blue House" }]);
    // The member sees their admin-only answer but not the admin-managed note.
    const mine = await api().get(`${base}/memberships/me`).set(asha.headers);
    expect(mine.body.data.fields.map((x: { key: string }) => x.key)).toEqual(["house", "roll_no"]);
    const list = await api().get(`${base}/admin/members`).set(admin.headers);
    expect(list.body.data.find((m: { id: string }) => m.id === asha.membership.id).fields).toHaveLength(3);
  });

  it("filters the directory by choice, multi-choice and yes/no fields", async () => {
    const { base, admin, create, tenant } = await setup();
    const f = await standardFields(create);
    const a = await memberSession(ctx, tenant.id, { fullName: "Asha" });
    const b = await memberSession(ctx, tenant.id, { fullName: "Bala" });
    await api().patch(`${base}/memberships/me`).set(a.headers).send({ fields: { house: "blue", sports: ["chess"], hostel: true } });
    await api().patch(`${base}/memberships/me`).set(b.headers).send({ fields: { house: "red", sports: ["chess", "cricket"], hostel: false, roll_no: "x" } });
    const names = async (qs: string) => (await api().get(`${base}/directory?${qs}`).set(a.headers)).body.data.map((m: { fullName: string }) => m.fullName);
    expect(await names("field=house:blue")).toEqual(["Asha"]);
    expect(await names("field=sports:cricket")).toEqual(["Bala"]);
    expect(await names("field=sports:chess&field=hostel:false")).toEqual(["Bala"]);
    expect(await names("field=hostel:true")).toEqual(["Asha"]);
    expect(await names("field=roll_no:x")).toEqual([]); // admin-only fields can't be searched

    const filters = await api().get(`${base}/directory/filters`).set(a.headers);
    expect(filters.body.data.fields.map((x: { key: string }) => x.key)).toEqual(["house", "sports", "hostel"]);
    // Removing an option keeps existing answers valid; type can't change once answered.
    await api().patch(`${base}/admin/profile-fields/${f.house.id}`).set(admin.headers).send({ options: [{ value: "red", label: "Red House" }] });
    expect((await api().patch(`${base}/memberships/me`).set(a.headers).send({ fields: { house: "blue" } })).status).toBe(200);
    expect((await api().patch(`${base}/memberships/me`).set(b.headers).send({ fields: { house: "blue" } })).status).toBe(400);
    const typeChange = await api().patch(`${base}/admin/profile-fields/${f.house.id}`).set(admin.headers).send({ type: "TEXT", options: [], filterable: false });
    expect(typeChange.status).toBe(409);
    expect((await api().patch(`${base}/admin/profile-fields/${f.roll.id}`).set(admin.headers).send({ type: "LONG_TEXT" })).status).toBe(409);
  });
});
