import { randomUUID } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  CHAT_ATTACHMENT_GONE_TEXT,
  CHAT_ATTACHMENT_LIMIT_TEXT,
  CHAT_ATTACHMENT_TYPE_PROBLEM,
  CHAT_ATTACHMENTS_NOT_YET_TEXT,
  CHAT_ATTACHMENTS_OFF_TEXT,
  CHAT_FILE_SIZE_PROBLEM,
  IMAGE_SIZE_PROBLEM,
  defaultFeaturesFor,
  type ChatAttachmentDto,
  type ChatAttachmentLinksDto,
  type ChatConversationDto,
  type ChatMessageDto,
  type TenantType,
} from "@illuminize/shared";
import { CHAT_ATTACHMENTS_OFF_CAPTION, chatFileName } from "@illuminize/shared/chat";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { chatAttachments, chatConversations, chatGroups, chatMessages, memberships, notifications, tenantSettings } from "../../src/db/schema";
import { keys } from "../../src/redis/keys";
import { markMessageRemoved } from "../../src/repositories/chat.repo";
import { chatAttachmentKeys, type ChatAttachmentRow } from "../../src/repositories/chatAttachments.repo";
import { upsertPushToken } from "../../src/repositories/users.repo";
import { scheduledJobs } from "../../src/jobs/schedules";
import { sweepUnsentChatAttachments } from "../../src/services/chat/attachments.service";
import { ExpoPushChannel } from "../../src/services/notifications/ExpoPushChannel";
import type { LocalPrivateStorage } from "../../src/services/storage";
import { invalidateTenantCache } from "../../src/services/tenant.service";
import { capturingLogger } from "../helpers/capturingLogger";
import { acceptedThread, ageRequest, chatApi, comparable, comparableFooter, comparableMessage, createGroup, groupsApi, newKey, openRequest, type Session } from "../helpers/chat";
import { untilSomeoneSleeps, withTrigger } from "../helpers/db";
import { createTenant, memberSession } from "../helpers/factories";
import { CAMERA_MAKE, GPS_MARKER, HEIC_START, cameraJpeg, testPng } from "../helpers/images";
import { CapturingRealtime } from "../helpers/realtimeHarness";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();
const PNG = await testPng(64, 48);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n", "latin1");
/** A file name nothing else in a test writes, so finding it anywhere it mustn't be is meaningful. */
const FILE_NAME = "Quarterly figures Zq8W.pdf";
const HOUR_MS = 60 * 60 * 1000;

interface Pushed {
  to: string;
  title: string;
  body?: string;
  data: Record<string, unknown>;
}

function fakeExpo() {
  const sent: Pushed[] = [];
  const impl = (async (_url: string | URL | Request, init?: RequestInit) => {
    const batch = JSON.parse(String(init?.body)) as Pushed[];
    sent.push(...batch);
    return new Response(JSON.stringify({ data: batch.map((m) => ({ status: "ok", id: `t:${m.to}` })) }), { status: 200 });
  }) as typeof fetch;
  return { sent, impl };
}

describe.skipIf(!dbAvailable)("chat attachments", () => {
  let ctx: TestContext;
  let realtime: CapturingRealtime;
  beforeAll(async () => {
    realtime = new CapturingRealtime();
    ctx = await createTestContext({}, { realtime });
  });
  beforeEach(async () => {
    await ctx.truncateAll();
    realtime.clear();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  async function setup(opts: { type?: TenantType } = {}) {
    const { tenant } = await createTenant(ctx, opts);
    const a = await memberSession(ctx, tenant.id, { fullName: "Asha Rao" });
    const b = await memberSession(ctx, tenant.id, { fullName: "Bilal Khan" });
    const chat = (m: Session) => chatApi(ctx, tenant.slug, m);
    const groups = (m: Session) => groupsApi(ctx, tenant.slug, m);
    /** Sets the Chat attachments switch as an admin's save would, the institution's cache included. */
    const setAttachments = async (on: boolean) => {
      await ctx.db
        .update(tenantSettings)
        .set({ features: { ...defaultFeaturesFor(tenant.type), chatAttachments: on } })
        .where(eq(tenantSettings.tenantId, tenant.id));
      await invalidateTenantCache(ctx, tenant.slug);
    };
    return { tenant, a, b, chat, groups, setAttachments };
  }
  type Setup = Awaited<ReturnType<typeof setup>>;

  const uploadPhoto = async (api: ReturnType<typeof chatApi>, id: string, file = PNG): Promise<ChatAttachmentDto> => {
    const res = await api.attach(id, file);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data as ChatAttachmentDto;
  };
  const uploadPdf = async (api: ReturnType<typeof chatApi>, id: string, name = FILE_NAME): Promise<ChatAttachmentDto> => {
    const res = await api.attach(id, PDF, { filename: "upload.pdf", contentType: "application/pdf", name });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data as ChatAttachmentDto;
  };
  const sendWith = async (api: ReturnType<typeof chatApi>, id: string, input: { body?: string; attachmentIds: string[]; clientKey?: string }): Promise<ChatMessageDto> => {
    const res = await api.sendWith(id, input);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data as ChatMessageDto;
  };
  const linksOf = async (api: ReturnType<typeof chatApi>, id: string, messageIds: string[]): Promise<ChatAttachmentLinksDto> => {
    const res = await api.links(id, messageIds);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data as ChatAttachmentLinksDto;
  };

  const attachmentRow = async (id: string): Promise<ChatAttachmentRow | undefined> => (await ctx.db.select().from(chatAttachments).where(eq(chatAttachments.id, id)))[0];
  const allRows = () => ctx.db.select().from(chatAttachments);
  const privateRoot = () => (ctx.privateStorage as LocalPrivateStorage).root;
  const stored = (key: string) => readFile(join(privateRoot(), key));
  const isStored = (key: string) => access(join(privateRoot(), key)).then(
    () => true,
    () => false,
  );
  const lastSeq = async (id: string) => (await ctx.db.select({ lastSeq: chatConversations.lastSeq }).from(chatConversations).where(eq(chatConversations.id, id)))[0]!.lastSeq;
  const pathOf = (url: string) => new URL(url).pathname;
  const open = (url: string) => request(ctx.app).get(pathOf(url)).buffer(true);
  /** The institution's chat files counted today: null until one has passed every check and is about to be saved. */
  const filesToday = (tenantId: string) => ctx.redis.get(keys.chatFilesDay(tenantId, new Date().toISOString().slice(0, 10)));
  const withRateLimits = async (fn: () => Promise<void>) => {
    process.env.RATE_LIMIT_IN_TESTS = "1";
    try {
      await fn();
    } finally {
      delete process.env.RATE_LIMIT_IN_TESTS;
    }
  };

  describe("uploading", () => {
    it("re-encodes a photo upright and without its metadata, GPS included, keeps a thumbnail, and leaves it unsent", async () => {
      const { a, b, chat, tenant } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      const photo = await cameraJpeg();
      expect(photo.includes(GPS_MARKER)).toBe(true);

      const res = await chat(a).attach(id, photo, { filename: "IMG_0001.jpg", contentType: "image/jpeg" });
      expect(res.status).toBe(201);
      const dto = res.body.data as ChatAttachmentDto;
      expect(dto).toMatchObject({ kind: "PHOTO", name: null, contentType: "image/jpeg", width: 40, height: 80 });
      // Described, never addressed: no key, link, uploader or conversation.
      expect(Object.keys(dto).sort()).toEqual(["contentType", "height", "id", "kind", "name", "size", "width"]);

      const row = (await attachmentRow(dto.id))!;
      expect(row).toMatchObject({ tenantId: tenant.id, conversationId: id, uploaderMembershipId: a.membership.id, messageId: null, kind: "PHOTO", fileName: null, byteSize: dto.size });
      const full = await stored(row.storageKey);
      const thumb = await stored(row.thumbKey!);
      expect(full.length).toBe(dto.size);
      expect(await sharp(full).metadata()).toMatchObject({ format: "jpeg", width: 40, height: 80 });
      expect((await sharp(full).metadata()).exif).toBeUndefined();
      expect((await sharp(thumb).metadata()).format).toBe("webp");
      for (const copy of [full, thumb]) {
        expect(copy.includes(GPS_MARKER)).toBe(false);
        expect(copy.includes(CAMERA_MAKE)).toBe(false);
      }
    });

    it("keeps a PDF as it came, under the UTF-8 name from its own field, cleaned, or else the part's own name", async () => {
      const { a, b, chat, tenant } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      const raw = "../Résumé – Priya‮ 2026.pdf";
      expect(chatFileName(raw)).toBe("Résumé – Priya 2026.pdf");

      const named = await uploadPdf(chat(a), id, raw);
      expect(named).toMatchObject({ kind: "FILE", name: "Résumé – Priya 2026.pdf", contentType: "application/pdf", size: PDF.length, width: null, height: null });
      const row = (await attachmentRow(named.id))!;
      expect(row.thumbKey).toBeNull();
      expect(Buffer.compare(await stored(row.storageKey), PDF)).toBe(0);
      // The key is the server's own, and never carries the name.
      expect(row.storageKey).not.toContain("sum");

      const res = await chat(a).attach(id, PDF, { filename: "Café menu.pdf", contentType: "application/pdf" });
      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe("Café menu.pdf");
    });

    it("decides what a file is by its bytes, whatever it's called or says it is", async () => {
      const { a, b, chat, tenant } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      const html = Buffer.from("<!doctype html><script>alert(1)</script>", "utf8");
      for (const res of [
        await chat(a).attach(id, html, { filename: "invoice.pdf", contentType: "application/pdf" }),
        await chat(a).attach(id, html, { filename: "page.html", contentType: "text/html" }),
        await chat(a).attach(id, Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"), { filename: "logo.png", contentType: "image/png" }),
        // The phone converts a HEIC photo before it uploads; one that arrives as it is can't be shown everywhere.
        await chat(a).attach(id, HEIC_START, { filename: "IMG_0002.heic", contentType: "image/heic" }),
      ]) {
        expect(res.status).toBe(415);
        expect(res.body.error).toMatchObject({ code: "UNSUPPORTED_MEDIA", message: CHAT_ATTACHMENT_TYPE_PROBLEM });
      }
      expect(await allRows()).toEqual([]);
      // A refused file costs the institution nothing.
      expect(await filesToday(tenant.id)).toBeNull();

      // A photo labelled as a PDF is a photo.
      const res = await chat(a).attach(id, PNG, { filename: "scan.pdf", contentType: "application/pdf" });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ kind: "PHOTO", name: null, contentType: "image/png" });
    });

    it("refuses one over the size limit in the words the apps use", async () => {
      const { a, b, chat, tenant } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      const big = Buffer.concat([PDF, Buffer.alloc(11 * 1024 * 1024 - PDF.length, 0x20)]);
      const pdf = await chat(a).attach(id, big, { filename: "big.pdf", contentType: "application/pdf" });
      expect(pdf.status).toBe(413);
      expect(pdf.body.error).toMatchObject({ code: "PAYLOAD_TOO_LARGE", message: CHAT_FILE_SIZE_PROBLEM });
      const image = await chat(a).attach(id, big, { filename: "big.png", contentType: "image/png" });
      expect(image.body.error).toMatchObject({ code: "PAYLOAD_TOO_LARGE", message: IMAGE_SIZE_PROBLEM });
      // A photo comes prepared, so one over 5 MB is refused before anything decodes it.
      const unprepared = Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024, 1)]);
      const photo = await chat(a).attach(id, unprepared, { filename: "huge.png", contentType: "image/png" });
      expect(photo.status).toBe(413);
      expect(photo.body.error.message).toBe(IMAGE_SIZE_PROBLEM);
      expect(await allRows()).toEqual([]);
      expect(await filesToday(tenant.id)).toBeNull();
    });

    it("is only for a thread where a send could carry it, and a block by the other member doesn't show", async () => {
      const s = await setup();
      const { tenant, a, b, chat } = s;
      const c = await memberSession(ctx, tenant.id);
      const refusal = async (m: Session, id: string) => {
        const res = await chat(m).attach(id, PNG);
        return { status: res.status, error: res.body.error };
      };

      const accepted = await acceptedThread(ctx, tenant.slug, a, b);
      expect((await refusal(c, accepted)).status).toBe(404);

      const asked = (await openRequest(ctx, tenant.slug, a, c.membership.id)).conversation.id;
      const notYet = { status: 409, error: { code: "CHAT_ATTACHMENTS_NOT_YET", message: CHAT_ATTACHMENTS_NOT_YET_TEXT } };
      expect(await refusal(a, asked)).toEqual(notYet);
      // Asking again is a request too.
      await ageRequest(ctx, asked, 31);
      expect(await refusal(a, asked)).toEqual(notYet);
      await ctx.db.update(chatConversations).set({ directState: "CLOSED" }).where(eq(chatConversations.id, asked));
      expect(await refusal(a, asked)).toEqual(notYet);
      await ctx.db.update(chatConversations).set({ directState: "PENDING" }).where(eq(chatConversations.id, asked));
      // Their reply would accept, so the one asked may.
      expect((await chat(c).attach(asked, PNG)).status).toBe(201);

      await chat(b).block(a.membership.id);
      expect((await chat(a).attach(accepted, PNG)).status).toBe(201);
      const mine = await refusal(b, accepted);
      expect(mine).toMatchObject({ status: 409, error: { code: "CHAT_BLOCKED_BY_YOU" } });

      await s.setAttachments(false);
      expect(await refusal(c, asked)).toEqual({ status: 403, error: { code: "FEATURE_DISABLED", message: CHAT_ATTACHMENTS_OFF_TEXT } });
      await ctx.db.update(tenantSettings).set({ features: { ...defaultFeaturesFor(tenant.type), messaging: false } }).where(eq(tenantSettings.tenantId, tenant.id));
      expect(await refusal(c, asked)).toMatchObject({ status: 403, error: { code: "FEATURE_DISABLED" } });
    });

    it("is refused in a group that can't take messages, and in another institution's thread", async () => {
      const { tenant, a, b, chat, groups } = await setup();
      const group = await createGroup(ctx, tenant.slug, a, { name: "Book club" });
      await groups(b).join(group.id);
      expect((await chat(b).attach(group.id, PNG)).status).toBe(201);
      await groups(a).archive(group.id);
      const archived = await chat(b).attach(group.id, PNG);
      expect(archived.status).toBe(409);
      expect(archived.body.error.message).toBe("This group has been archived, so it's read-only");

      const other = await setup();
      const id = await acceptedThread(ctx, other.tenant.slug, other.a, other.b);
      expect((await chat(a).attach(id, PNG)).status).toBe(404);
    });

    it("is refused where the other member can't be contacted, as a send is", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      await ctx.db.update(memberships).set({ status: "SUSPENDED" }).where(eq(memberships.id, b.membership.id));
      const res = await chat(a).attach(id, PNG);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("CONTACT_UNAVAILABLE");
      expect((await chat(a).get(id)).body.data).toMatchObject({ canSend: false, canAttach: false });
      expect(await allRows()).toEqual([]);
    });

    it("asks for the file when none came", async () => {
      const { tenant, a, b } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      const res = await request(ctx.app).post(`/api/v1/t/${tenant.slug}/chat/conversations/${id}/attachments`).set(a.headers).field("name", FILE_NAME);
      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe("Attach a photo or a PDF in the 'file' field");
      expect(await allRows()).toEqual([]);
    });

    it("counts nothing against the member or the institution when the thread refuses it", async () => {
      const { tenant, a, b, chat } = await setup();
      const asked = (await openRequest(ctx, tenant.slug, a, b.membership.id)).conversation.id;
      await withRateLimits(async () => {
        expect((await chat(a).attach(asked, PNG)).status).toBe(409);
        expect(await ctx.redis.get(keys.rateLimit("chat-attach", a.membership.id))).toBeNull();
        expect(await ctx.redis.get(keys.rateLimit("chat-attach-bytes", a.membership.id))).toBeNull();
        expect(await ctx.redis.get(keys.chatFilesDay(tenant.id, new Date().toISOString().slice(0, 10)))).toBeNull();
      });
    });
  });

  describe("sending", () => {
    it("sends photos and a PDF with no words, in the order named, and both sides read the same", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      const photo = await uploadPhoto(chat(a), id);
      const pdf = await uploadPdf(chat(a), id);
      realtime.clear();

      const sent = await sendWith(chat(a), id, { attachmentIds: [pdf.id, photo.id] });
      expect(sent).toMatchObject({ body: "", kind: "TEXT", removed: false });
      expect(sent.attachments).toEqual([pdf, photo]);
      expect((await attachmentRow(pdf.id))).toMatchObject({ messageId: sent.id, position: 0 });
      expect((await attachmentRow(photo.id))).toMatchObject({ messageId: sent.id, position: 1 });

      const read = (await chat(b).messages(id)).body.data as ChatMessageDto[];
      expect(read.find((m) => m.id === sent.id)!.attachments).toEqual([pdf, photo]);
      const live = realtime.to(b.user.id, "chat:message").map((e) => (e.payload as { message: ChatMessageDto }).message);
      expect(live.map((m) => m.attachments)).toEqual([[pdf, photo]]);
      // Deliveries describe; only the links route links.
      expect(JSON.stringify(realtime.events)).not.toMatch(/\/files\/|https?:/);
    });

    it("takes words with them", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      const photo = await uploadPhoto(chat(a), id);
      const sent = await sendWith(chat(a), id, { body: "From Saturday", attachmentIds: [photo.id] });
      expect(sent).toMatchObject({ body: "From Saturday", attachments: [photo] });
    });

    it("refuses more than four, the same one twice, or nothing at all", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
      const tooMany = await chat(a).sendWith(id, { attachmentIds: ids });
      expect(tooMany.status).toBe(400);
      expect(JSON.stringify(tooMany.body.error.details)).toContain(CHAT_ATTACHMENT_LIMIT_TEXT);
      expect((await chat(a).sendWith(id, { attachmentIds: [ids[0]!, ids[0]!] })).status).toBe(400);
      const empty = await chat(a).sendWith(id, { body: " ​ ", attachmentIds: [] });
      expect(empty.status).toBe(400);
      expect(empty.body.error.details).toEqual([expect.objectContaining({ path: "body", message: "Write a message" })]);
    });

    it("refuses, sending nothing, an upload it can't claim: sent already, someone else's, another thread's or unknown", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      const other = await acceptedThread(ctx, tenant.slug, a, await memberSession(ctx, tenant.id));
      const used = await uploadPhoto(chat(a), id);
      await sendWith(chat(a), id, { attachmentIds: [used.id] });
      const fresh = await uploadPhoto(chat(a), id);
      const theirs = await uploadPhoto(chat(b), id);
      const elsewhere = await uploadPhoto(chat(a), other);
      const before = await lastSeq(id);

      for (const stale of [used.id, theirs.id, elsewhere.id, randomUUID()]) {
        const res = await chat(a).sendWith(id, { body: "With this", attachmentIds: [fresh.id, stale] });
        expect(res.status).toBe(409);
        expect(res.body.error).toMatchObject({ code: "CHAT_ATTACHMENT_GONE", message: CHAT_ATTACHMENT_GONE_TEXT });
      }
      // The message and its place in the thread rolled back with it, and the good upload is still there to send.
      expect(await lastSeq(id)).toBe(before);
      expect((await attachmentRow(fresh.id))!.messageId).toBeNull();
      expect((await sendWith(chat(a), id, { attachmentIds: [fresh.id] })).attachments).toEqual([fresh]);
    });

    it("returns the original with its photos and files on a retry, whatever the retry names", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      const photo = await uploadPhoto(chat(a), id);
      const clientKey = newKey();
      const first = await sendWith(chat(a), id, { body: "Look", attachmentIds: [photo.id], clientKey });
      const again = await sendWith(chat(a), id, { body: "Look", attachmentIds: [photo.id], clientKey });
      expect(again).toEqual(first);
      const another = await uploadPhoto(chat(a), id);
      expect(await sendWith(chat(a), id, { body: "Look", attachmentIds: [another.id], clientKey })).toEqual(first);
      expect((await attachmentRow(another.id))!.messageId).toBeNull();
    });

    it("keeps a first message to someone words only", async () => {
      const { tenant, a, b } = await setup();
      const res = await request(ctx.app)
        .post(`/api/v1/t/${tenant.slug}/chat/direct`)
        .set(a.headers)
        .send({ membershipId: b.membership.id, body: "Hello", clientKey: newKey(), attachmentIds: [randomUUID()] });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body.error.details)).toContain(CHAT_ATTACHMENTS_NOT_YET_TEXT);
      expect(await ctx.db.select().from(chatConversations)).toEqual([]);
    });

    it("never goes in a request, asking again included, and the refusal changes nothing", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = (await openRequest(ctx, tenant.slug, a, b.membership.id)).conversation.id;
      // An upload made while it could go (here, as the one asked) is no way round it either.
      const theirs = await uploadPhoto(chat(b), id);
      await ageRequest(ctx, id, 31);
      const before = await ctx.db.select().from(chatConversations).where(eq(chatConversations.id, id));
      const res = await chat(a).sendWith(id, { body: "Asking again", attachmentIds: [theirs.id] });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatchObject({ code: "CHAT_ATTACHMENTS_NOT_YET", message: CHAT_ATTACHMENTS_NOT_YET_TEXT });
      expect(await ctx.db.select().from(chatConversations).where(eq(chatConversations.id, id))).toEqual(before);
      // Words alone ask again as usual.
      expect((await chat(a).send(id, "Asking again")).status).toBe(201);
    });

    it("answers a request with photos, which accepts it", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = (await openRequest(ctx, tenant.slug, a, b.membership.id)).conversation.id;
      const photo = await uploadPhoto(chat(b), id);
      expect((await sendWith(chat(b), id, { attachmentIds: [photo.id] })).attachments).toEqual([photo]);
      expect((await chat(a).get(id)).body.data).toMatchObject({ state: "ACCEPTED", canAttach: true });
    });

    it("with the switch off, refuses new uploads and sends carrying them, read fresh, and leaves words and what was sent", async () => {
      const s = await setup();
      const { tenant, a, b, chat } = s;
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      const sent = await sendWith(chat(a), id, { attachmentIds: [(await uploadPhoto(chat(a), id)).id] });
      const waiting = await uploadPhoto(chat(a), id);

      // Only the database: what sends reads it fresh, not from the institution's cache.
      await ctx.db.update(tenantSettings).set({ features: { ...defaultFeaturesFor(tenant.type), chatAttachments: false } }).where(eq(tenantSettings.tenantId, tenant.id));
      const off = { code: "FEATURE_DISABLED", message: CHAT_ATTACHMENTS_OFF_TEXT };
      expect((await chat(a).attach(id, PNG)).body.error).toEqual(off);
      expect((await chat(a).sendWith(id, { attachmentIds: [waiting.id] })).body.error).toEqual(off);
      expect((await chat(a).send(id, "Words still go")).status).toBe(201);
      expect((await linksOf(chat(b), id, [sent.id])).links).toHaveLength(1);
      await invalidateTenantCache(ctx, tenant.slug);
      expect((await chat(a).get(id)).body.data.canAttach).toBe(false);
    });

    it("goes to a group, and not once the switch is off", async () => {
      const s = await setup();
      const { tenant, a, b, chat, groups } = s;
      const group = await createGroup(ctx, tenant.slug, a, { name: "Book club" });
      await groups(b).join(group.id);
      const pdf = await uploadPdf(chat(b), group.id);
      const sent = await sendWith(chat(b), group.id, { body: "Minutes", attachmentIds: [pdf.id] });
      const read = (await chat(a).messages(group.id)).body.data as ChatMessageDto[];
      expect(read.find((m) => m.id === sent.id)!.attachments).toEqual([pdf]);

      const waiting = await uploadPdf(chat(b), group.id);
      await s.setAttachments(false);
      expect((await chat(b).sendWith(group.id, { attachmentIds: [waiting.id] })).body.error.code).toBe("FEATURE_DISABLED");
    });
  });

  describe("canAttach", () => {
    it("is true where a send could carry photos and files, and false in a request, a closed thread, a block of theirs or with the switch off", async () => {
      const s = await setup();
      const { tenant, a, b, chat, groups } = s;
      const c = await memberSession(ctx, tenant.id);
      const d = await memberSession(ctx, tenant.id);
      const canAttach = async (m: Session, id: string) => ((await chat(m).get(id)).body.data as ChatConversationDto).canAttach;

      const accepted = await acceptedThread(ctx, tenant.slug, a, b);
      const asked = (await openRequest(ctx, tenant.slug, a, c.membership.id)).conversation.id;
      const closed = await acceptedThread(ctx, tenant.slug, a, d);
      await ctx.db.update(chatConversations).set({ directState: "CLOSED" }).where(eq(chatConversations.id, closed));
      const group = await createGroup(ctx, tenant.slug, a, { name: "Book club" });
      await groups(b).join(group.id);

      expect([await canAttach(a, accepted), await canAttach(b, accepted)]).toEqual([true, true]);
      expect([await canAttach(a, asked), await canAttach(c, asked)]).toEqual([false, true]);
      expect(await canAttach(a, closed)).toBe(false);
      // Once they may ask again they can send, as a new request, and still not attach.
      await ageRequest(ctx, asked, 31);
      expect((await chat(a).get(asked)).body.data).toMatchObject({ canSend: true, canAttach: false });
      expect(await canAttach(b, group.id)).toBe(true);
      // The list says the same as the thread.
      const listed = ((await chat(a).list()).body.data as ChatConversationDto[]).find((t) => t.id === accepted)!;
      expect(listed.canAttach).toBe(true);

      await chat(a).block(b.membership.id);
      expect([await canAttach(a, accepted), await canAttach(b, accepted)]).toEqual([false, true]);
      await groups(a).archive(group.id);
      expect(await canAttach(b, group.id)).toBe(false);

      await s.setAttachments(false);
      expect([await canAttach(c, asked), await canAttach(b, accepted)]).toEqual([false, false]);
      const footer = comparableFooter((await chat(b).get(accepted)).body.data);
      expect(footer).toEqual({ kind: "composer", intro: null, attachCaption: CHAT_ATTACHMENTS_OFF_CAPTION });
    });
  });

  describe("blocks and declines stay invisible", () => {
    it("uploads, sends and reads where the other member blocked them exactly as where they didn't", async () => {
      const { tenant, chat } = await setup();
      const pair = async () => {
        const [from, to] = [await memberSession(ctx, tenant.id), await memberSession(ctx, tenant.id)];
        return { from, to, id: await acceptedThread(ctx, tenant.slug, from, to) };
      };
      const normal = await pair();
      const blocked = await pair();
      await chat(blocked.to).block(blocked.from.membership.id);

      const sendBoth = async (t: Awaited<ReturnType<typeof pair>>, key: string) => {
        const photo = await chat(t.from).attach(t.id, PNG);
        const pdf = await chat(t.from).attach(t.id, PDF, { filename: "a.pdf", contentType: "application/pdf", name: FILE_NAME });
        return { photo, pdf, sent: await chat(t.from).sendWith(t.id, { body: "Both", attachmentIds: [photo.body.data.id, pdf.body.data.id], clientKey: key }) };
      };
      const [n, x] = [await sendBoth(normal, "key-for-comparing-1"), await sendBoth(blocked, "key-for-comparing-2")];
      expect([x.photo.status, x.pdf.status, x.sent.status]).toEqual([n.photo.status, n.pdf.status, n.sent.status]);
      expect({ ...x.photo.body.data, id: "<id>" }).toEqual({ ...n.photo.body.data, id: "<id>" });
      expect(comparableMessage(x.sent.body.data)).toEqual(comparableMessage(n.sent.body.data));

      const senderView = async (t: Awaited<ReturnType<typeof pair>>, messageId: string) => {
        const thread = (await chat(t.from).get(t.id)).body.data as ChatConversationDto;
        const links = await linksOf(chat(t.from), t.id, [messageId]);
        return {
          thread: comparable(thread),
          footer: comparableFooter(thread),
          messages: ((await chat(t.from).messages(t.id)).body.data as ChatMessageDto[]).map(comparableMessage),
          list: ((await chat(t.from).list()).body.data as ChatConversationDto[]).map(comparable),
          links: links.links.map((l) => [l.thumbUrl === null, typeof l.url]),
        };
      };
      const expected = await senderView(normal, n.sent.body.data.id);
      expect(expected.thread).toMatchObject({ canAttach: true, lastMessage: { attachments: { photos: 1, files: 1, fileName: FILE_NAME } } });
      expect(await senderView(blocked, x.sent.body.data.id)).toEqual(expected);

      // The blocker never received it, so its files are no more theirs to open than its words.
      expect((await linksOf(chat(blocked.to), blocked.id, [x.sent.body.data.id])).links).toEqual([]);
      expect((await linksOf(chat(normal.to), normal.id, [n.sent.body.data.id])).links).toHaveLength(2);
    });

    it("tells a requester the same about photos and files whether the request waits, was declined or met a block", async () => {
      const { tenant, chat } = await setup();
      const ask = async () => {
        const [from, to] = [await memberSession(ctx, tenant.id), await memberSession(ctx, tenant.id)];
        return { from, to, id: (await openRequest(ctx, tenant.slug, from, to.membership.id)).conversation.id };
      };
      const [waiting, declined, blocked] = [await ask(), await ask(), await ask()];
      await chat(declined.to).decline(declined.id);
      await chat(blocked.to).block(blocked.from.membership.id);
      const view = async (t: Awaited<ReturnType<typeof ask>>) => {
        const thread = (await chat(t.from).get(t.id)).body.data as ChatConversationDto;
        const upload = await chat(t.from).attach(t.id, PNG);
        return { canAttach: thread.canAttach, footer: comparableFooter(thread), upload: { status: upload.status, error: upload.body.error } };
      };
      const expected = await view(waiting);
      expect(expected).toMatchObject({ canAttach: false, upload: { status: 409 } });
      expect(await view(declined)).toEqual(expected);
      expect(await view(blocked)).toEqual(expected);

      // Asking again shows the box with its intro, and says the same about photos and files.
      for (const t of [waiting, declined, blocked]) await ageRequest(ctx, t.id, 31);
      const again = await view(waiting);
      expect(again.footer).toMatchObject({ kind: "composer", attachCaption: "Photos and files can be sent once <name> accepts." });
      expect(await view(declined)).toEqual(again);
      expect(await view(blocked)).toEqual(again);
    });
  });

  describe("links", () => {
    it("signs each copy for ten minutes, and each opens as it should", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      const photo = await uploadPhoto(chat(a), id);
      const pdf = await uploadPdf(chat(a), id);
      const sent = await sendWith(chat(a), id, { attachmentIds: [photo.id, pdf.id] });

      const before = Date.now();
      const res = await chat(b).links(id, [sent.id]);
      const after = Date.now();
      expect(res.headers["cache-control"]).toBe("no-store");
      const { expiresAt, links } = res.body.data as ChatAttachmentLinksDto;
      // Never later than the links themselves, which count whole seconds from when each was signed.
      expect(Date.parse(expiresAt)).toBeGreaterThan(before + 598_000);
      expect(Date.parse(expiresAt)).toBeLessThanOrEqual(after + 600_000);
      expect(links.map((l) => [l.id, l.messageId, l.thumbUrl === null])).toEqual([
        [photo.id, sent.id, false],
        [pdf.id, sent.id, true],
      ]);

      const [photoLinks, pdfLinks] = links;
      expect((await open(photoLinks!.url)).headers["content-type"]).toBe("image/png");
      expect((await open(photoLinks!.thumbUrl!)).headers["content-type"]).toBe("image/webp");
      expect((await open(photoLinks!.downloadUrl)).headers["content-disposition"]).toMatch(/^attachment; filename="photo\.png"/);
      const file = await open(pdfLinks!.downloadUrl);
      expect(file.status).toBe(200);
      expect(file.headers["content-disposition"]).toContain(`filename="${FILE_NAME}"`);
      expect(Buffer.compare(file.body as Buffer, PDF)).toBe(0);
      // The link holds no name, and the sender gets links to their own message too.
      expect(links.every((l) => !l.url.includes("Quarterly"))).toBe(true);
      expect((await linksOf(chat(a), id, [sent.id])).links).toHaveLength(2);
    });

    it("refuses a thread that isn't theirs, and leaves out a removed message, another thread's and one with none", async () => {
      const { tenant, a, b, chat } = await setup();
      const c = await memberSession(ctx, tenant.id);
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      const other = await acceptedThread(ctx, tenant.slug, a, c);
      const kept = await sendWith(chat(a), id, { attachmentIds: [(await uploadPhoto(chat(a), id)).id] });
      const removed = await sendWith(chat(a), id, { attachmentIds: [(await uploadPhoto(chat(a), id)).id] });
      const elsewhere = await sendWith(chat(a), other, { attachmentIds: [(await uploadPhoto(chat(a), other)).id] });
      const words = (await chat(a).send(id, "Just words")).body.data as ChatMessageDto;
      await markMessageRemoved(ctx.db, tenant.id, removed.id, { removedByUserId: c.user.id, removalNote: null });

      expect((await chat(c).links(id, [kept.id])).status).toBe(404);
      const links = await linksOf(chat(b), id, [kept.id, removed.id, elsewhere.id, words.id, randomUUID()]);
      expect(links.links.map((l) => l.messageId)).toEqual([kept.id]);
      for (const m of [a, b]) {
        const read = ((await chat(m).messages(id)).body.data as ChatMessageDto[]).find((x) => x.id === removed.id)!;
        expect(read).toMatchObject({ removed: true, body: null, attachments: [] });
      }
      // The rows stay, for a report's audited view.
      expect((await allRows()).filter((r) => r.messageId === removed.id)).toHaveLength(1);
    });

    it("follow the thread's own switch, as its messages do: refused in a direct thread once Messaging is off", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      const sent = await sendWith(chat(a), id, { attachmentIds: [(await uploadPhoto(chat(a), id)).id] });
      await ctx.db.update(tenantSettings).set({ features: { ...defaultFeaturesFor(tenant.type), messaging: false } }).where(eq(tenantSettings.tenantId, tenant.id));
      await invalidateTenantCache(ctx, tenant.slug);
      for (const res of [await chat(b).links(id, [sent.id]), await chat(b).messages(id)]) {
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe("FEATURE_DISABLED");
      }
    });

    it("asks for one to fifty messages at a time", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      expect((await chat(a).links(id, [])).status).toBe(400);
      expect((await chat(a).links(id, Array.from({ length: 51 }, () => randomUUID()))).status).toBe(400);
      expect((await chat(a).links(id, Array.from({ length: 50 }, () => randomUUID()))).status).toBe(200);
      expect((await chat(a).links(id, ["not-an-id"])).status).toBe(400);
    });

    it("in a group: leaves out what a member blocked, and what came before an invited member joined, and refuses who left or was removed", async () => {
      const { tenant, a, b, chat, groups } = await setup();
      const [c, d, e] = [await memberSession(ctx, tenant.id), await memberSession(ctx, tenant.id), await memberSession(ctx, tenant.id)];
      const group = await createGroup(ctx, tenant.slug, a, { name: "Committee", visibility: "INVITE_ONLY" });
      await groups(a).invite(group.id, [b.membership.id, c.membership.id, e.membership.id]);
      for (const m of [b, c, e]) expect((await groups(m).accept(group.id)).status).toBe(200);
      const before = await sendWith(chat(a), group.id, { attachmentIds: [(await uploadPhoto(chat(a), group.id)).id] });

      await chat(b).block(a.membership.id);
      const redacted = ((await chat(b).messages(group.id)).body.data as ChatMessageDto[]).find((m) => m.id === before.id)!;
      expect(redacted).toMatchObject({ redacted: true, attachments: [] });
      expect((await linksOf(chat(b), group.id, [before.id])).links).toEqual([]);
      expect((await linksOf(chat(c), group.id, [before.id])).links).toHaveLength(1);

      await groups(a).invite(group.id, [d.membership.id]);
      await groups(d).accept(group.id);
      const after = await sendWith(chat(a), group.id, { attachmentIds: [(await uploadPhoto(chat(a), group.id)).id] });
      expect((await linksOf(chat(d), group.id, [before.id, after.id])).links.map((l) => l.messageId)).toEqual([after.id]);

      await groups(c).leave(group.id);
      expect((await chat(c).links(group.id, [before.id])).status).toBe(404);
      expect((await groups(a).remove(group.id, e.membership.id)).status).toBeLessThan(300);
      expect((await chat(e).links(group.id, [before.id])).status).toBe(404);
    });

    it("in a group an admin rejected or removed: refused to its members, as the group is, and still open to its owner", async () => {
      const { tenant, a, b, chat, groups } = await setup();
      const group = await createGroup(ctx, tenant.slug, a, { name: "Book club" });
      expect((await groups(b).join(group.id)).status).toBeLessThan(300);
      const sent = await sendWith(chat(a), group.id, { attachmentIds: [(await uploadPhoto(chat(a), group.id)).id] });
      for (const moderationStatus of ["REJECTED", "REMOVED"] as const) {
        await ctx.db.update(chatGroups).set({ moderationStatus }).where(eq(chatGroups.conversationId, group.id));
        expect((await chat(b).get(group.id)).status).toBe(404);
        for (const res of [await chat(b).links(group.id, [sent.id]), await chat(b).attach(group.id, PNG)]) {
          expect(res.status).toBe(404);
          expect(res.body.error.code).toBe("NOT_FOUND");
        }
        // The owner still sees their group and what was sent there, but can't add to it.
        expect((await linksOf(chat(a), group.id, [sent.id])).links.map((l) => l.messageId)).toEqual([sent.id]);
        expect((await chat(a).attach(group.id, PNG)).status).toBe(409);
      }
      expect(await allRows()).toHaveLength(1);
    });
  });

  describe("inbox previews", () => {
    it("count the last message's photos and files, and say nothing of a removed or redacted one's", async () => {
      const { tenant, a, b, chat, groups } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      const lastOf = async (m: Session, conversationId: string) => ((await chat(m).list()).body.data as ChatConversationDto[]).find((t) => t.id === conversationId)!.lastMessage!;

      await sendWith(chat(a), id, { attachmentIds: [(await uploadPhoto(chat(a), id)).id, (await uploadPhoto(chat(a), id)).id] });
      expect((await lastOf(b, id)).attachments).toEqual({ photos: 2, files: 0, fileName: null });
      const pdfMessage = await sendWith(chat(b), id, { body: "Notes", attachmentIds: [(await uploadPdf(chat(b), id)).id] });
      expect(await lastOf(a, id)).toMatchObject({ body: "Notes", attachments: { photos: 0, files: 1, fileName: FILE_NAME } });
      await chat(a).send(id, "Thanks");
      expect((await lastOf(b, id)).attachments).toBeNull();
      expect(pdfMessage.attachments).toHaveLength(1);

      const group = await createGroup(ctx, tenant.slug, a, { name: "Book club" });
      await groups(b).join(group.id);
      await sendWith(chat(a), group.id, { attachmentIds: [(await uploadPhoto(chat(a), group.id)).id] });
      expect((await lastOf(b, group.id)).attachments).toEqual({ photos: 1, files: 0, fileName: null });
      await chat(b).block(a.membership.id);
      expect(await lastOf(b, group.id)).toMatchObject({ redacted: true, attachments: null });
    });

    it("keep a direct thread's photos after a block, which redacts only in a group, whatever else is on the page", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      const lastOf = async (conversationId: string) => ((await chat(a).list()).body.data as ChatConversationDto[]).find((t) => t.id === conversationId)!.lastMessage!;
      await sendWith(chat(b), id, { attachmentIds: [(await uploadPhoto(chat(b), id)).id] });
      await chat(a).block(b.membership.id);
      const alone = await lastOf(id);
      expect(alone).toMatchObject({ body: "", redacted: false, attachments: { photos: 1, files: 0, fileName: null } });
      // A group on the same page brings in the redaction of who they blocked, which a direct thread never takes.
      await createGroup(ctx, tenant.slug, a, { name: "Book club" });
      expect(await lastOf(id)).toEqual(alone);
      expect((await chat(a).get(id)).body.data.lastMessage).toEqual(alone);
    });

    it("say nothing of a removed last message's", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      const sent = await sendWith(chat(a), id, { attachmentIds: [(await uploadPdf(chat(a), id)).id] });
      await markMessageRemoved(ctx.db, tenant.id, sent.id, { removedByUserId: b.user.id, removalNote: null });
      const last = ((await chat(b).list()).body.data as ChatConversationDto[]).find((t) => t.id === id)!.lastMessage!;
      expect(last).toMatchObject({ body: null, attachments: null });
    });
  });

  describe("names and links", () => {
    it("never go into a push, a job, a notification or a log, and no link into a socket event", async () => {
      const { tenant, a, b } = await setup();
      const expo = fakeExpo();
      const { logger, text } = capturingLogger();
      const quietLogger = ctx.logger;
      // The jobs read the shared context, so it logs to the capture too while this runs.
      ctx.logger = logger;
      ctx.push = new ExpoPushChannel(ctx.db, ctx.redis, logger, undefined, expo.impl);
      const app = createApp(ctx);
      try {
        for (const m of [a, b]) await upsertPushToken(ctx.db, { userId: m.user.id, token: `ExponentPushToken[${m.user.id}]`, platform: "ANDROID" });
        const id = await acceptedThread(ctx, tenant.slug, a, b);
        await ctx.jobs.drain({ includeDelayed: true });
        expo.sent.length = 0;
        realtime.clear();

        const base = `/api/v1/t/${tenant.slug}/chat/conversations/${id}`;
        const upload = await request(app).post(`${base}/attachments`).set(a.headers).field("name", FILE_NAME).attach("file", PDF, { filename: FILE_NAME, contentType: "application/pdf" });
        expect(upload.status).toBe(201);
        const sent = await request(app).post(`${base}/messages`).set(a.headers).send({ clientKey: newKey(), attachmentIds: [upload.body.data.id] });
        expect(sent.status).toBe(201);
        const links = await request(app).get(`${base}/attachments?messageId=${sent.body.data.id}`).set(b.headers);
        expect(links.status).toBe(200);
        const download = await request(app).get(pathOf(links.body.data.links[0].downloadUrl)).buffer(true);
        expect(download.status).toBe(200);
        // A failure on the way, which is logged.
        expect((await request(app).post(`${base}/messages`).set(a.headers).send({ clientKey: newKey(), attachmentIds: [upload.body.data.id] })).status).toBe(409);
        const { failed } = await ctx.jobs.drain({ includeDelayed: true });
        expect(failed).toEqual([]);

        expect(expo.sent.map((p) => p.title)).toEqual(["New message from Asha Rao"]);
        const token = pathOf(links.body.data.links[0].url).split("/").pop()!;
        const outside = JSON.stringify([expo.sent, ctx.jobs.history, await ctx.db.select().from(notifications), text()]);
        for (const secret of ["Quarterly", "/files/", token]) expect(outside).not.toContain(secret);
        // A socket event delivers the message, which describes its file as it carries its words, and never links to it.
        const live = JSON.stringify(realtime.events);
        expect(live).toContain("Quarterly");
        for (const secret of ["/files/", token]) expect(live).not.toContain(secret);
      } finally {
        ctx.push = undefined;
        ctx.logger = quietLogger;
      }
    });
  });

  describe("the sweep", () => {
    /** An upload made `hours` ago. */
    async function aged(api: ReturnType<typeof chatApi>, id: string, hours: number): Promise<ChatAttachmentRow> {
      const dto = await uploadPhoto(api, id);
      await ctx.db.update(chatAttachments).set({ createdAt: new Date(Date.now() - hours * HOUR_MS) }).where(eq(chatAttachments.id, dto.id));
      return (await attachmentRow(dto.id))!;
    }

    it("runs hourly and deletes uploads unsent after a day, rows and files, and nothing sent or newer", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      const old = await aged(chat(a), id, 25);
      const recent = await aged(chat(a), id, 23);
      const sentOld = await aged(chat(a), id, 25);
      await sendWith(chat(a), id, { attachmentIds: [sentOld.id] });

      expect(scheduledJobs.find((s) => s.id === "chat-attachments-sweep")).toMatchObject({ job: "chat.sweepAttachments", data: {}, repeat: { every: HOUR_MS } });
      await ctx.jobs.runScheduled("chat-attachments-sweep");
      expect(await attachmentRow(old.id)).toBeUndefined();
      for (const key of chatAttachmentKeys(old)) expect(await isStored(key)).toBe(false);
      for (const row of [recent, sentOld]) {
        expect(await attachmentRow(row.id)).toBeDefined();
        for (const key of chatAttachmentKeys(row)) expect(await isStored(key)).toBe(true);
      }
      // The sent one still opens.
      const message = (await attachmentRow(sentOld.id))!.messageId!;
      expect((await linksOf(chat(b), id, [message])).links).toHaveLength(1);
    });

    it("keeps the rows and their files when its transaction fails, so no row is left pointing at a missing file", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      const old = await aged(chat(a), id, 25);
      await withTrigger(ctx, "after delete on chat_attachments", "raise exception 'refused for the test'; return old;", async () => {
        await expect(sweepUnsentChatAttachments(ctx)).rejects.toThrow();
      });
      expect(await attachmentRow(old.id)).toBeDefined();
      for (const key of chatAttachmentKeys(old)) expect(await isStored(key)).toBe(true);
      // The next sweep takes both.
      expect(await sweepUnsentChatAttachments(ctx)).toBe(1);
      expect(await attachmentRow(old.id)).toBeUndefined();
      for (const key of chatAttachmentKeys(old)) expect(await isStored(key)).toBe(false);
    });

    it("wins against a send that comes while it holds the upload, which finds it gone", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      const old = await aged(chat(a), id, 25);
      await withTrigger(ctx, "before delete on chat_attachments", "perform pg_sleep(0.5); return old;", async () => {
        const sweeping = sweepUnsentChatAttachments(ctx);
        await untilSomeoneSleeps(ctx);
        const res = await chat(a).sendWith(id, { attachmentIds: [old.id] });
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe("CHAT_ATTACHMENT_GONE");
        expect(await sweeping).toBe(1);
      });
      expect(await ctx.db.select().from(chatMessages).where(eq(chatMessages.conversationId, id))).toHaveLength(1);
    });

    it("leaves an upload a send is claiming, which the send keeps", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      const old = await aged(chat(a), id, 25);
      await withTrigger(ctx, "before update on chat_attachments", "perform pg_sleep(0.5); return new;", async () => {
        const sending = chat(a)
          .sendWith(id, { attachmentIds: [old.id] })
          .then((r) => r);
        await untilSomeoneSleeps(ctx);
        expect(await sweepUnsentChatAttachments(ctx)).toBe(0);
        expect((await sending).status).toBe(201);
      });
      expect((await attachmentRow(old.id))!.messageId).not.toBeNull();
      for (const key of chatAttachmentKeys(old)) expect(await isStored(key)).toBe(true);
    });
  });

  describe("deleting an account", () => {
    it("deletes their withheld and unsent uploads with their files, and keeps what they sent", async () => {
      const { tenant, a, b, chat } = await setup();
      const c = await memberSession(ctx, tenant.id);
      const delivered = await acceptedThread(ctx, tenant.slug, a, b);
      const withheldThread = await acceptedThread(ctx, tenant.slug, a, c);
      await chat(c).block(a.membership.id);

      const sentPhoto = await uploadPhoto(chat(a), delivered);
      const sent = await sendWith(chat(a), delivered, { attachmentIds: [sentPhoto.id] });
      const withheldPdf = await uploadPdf(chat(a), withheldThread);
      await sendWith(chat(a), withheldThread, { attachmentIds: [withheldPdf.id] });
      const unsent = await uploadPhoto(chat(a), delivered);
      const rows = { sent: (await attachmentRow(sentPhoto.id))!, withheld: (await attachmentRow(withheldPdf.id))!, unsent: (await attachmentRow(unsent.id))! };
      // Someone else's unsent upload stays.
      const theirs = (await attachmentRow((await uploadPhoto(chat(b), delivered)).id))!;

      expect((await request(ctx.app).post("/api/v1/me/delete").set(a.headers).send({ confirm: true })).status).toBeLessThan(300);

      expect(await attachmentRow(rows.withheld.id)).toBeUndefined();
      expect(await attachmentRow(rows.unsent.id)).toBeUndefined();
      for (const key of [...chatAttachmentKeys(rows.withheld), ...chatAttachmentKeys(rows.unsent)]) expect(await isStored(key)).toBe(false);
      for (const row of [rows.sent, theirs]) {
        expect(await attachmentRow(row.id)).toBeDefined();
        for (const key of chatAttachmentKeys(row)) expect(await isStored(key)).toBe(true);
      }
      expect((await linksOf(chat(b), delivered, [sent.id])).links).toHaveLength(1);
    });

    it("never leaves a file without its row when an upload is saved while the deletion runs", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      await uploadPhoto(chat(a), id);
      const filesOf = async () => (await readdir(join(privateRoot(), tenant.id))).map((name) => `${tenant.id}/${name}`);
      const before = new Set(await filesOf());
      // The deletion holds its locks, asleep while it deletes the unsent upload, as another upload comes in.
      const [deleted] = await withTrigger(ctx, "after delete on chat_attachments", "perform pg_sleep(0.5); return old;", async () => {
        const deleting = request(ctx.app).post("/api/v1/me/delete").set(a.headers).send({ confirm: true }).then((r) => r);
        await untilSomeoneSleeps(ctx);
        return Promise.all([deleting, chat(a).attach(id, PNG).then((r) => r)]);
      });
      expect(deleted.status).toBeLessThan(300);
      // Whatever became of that upload, its files went with its row, or the sweep a day on takes both.
      await sweepUnsentChatAttachments(ctx, new Date(Date.now() + 25 * HOUR_MS));
      expect(await allRows()).toEqual([]);
      expect((await filesOf()).filter((key) => !before.has(key))).toEqual([]);
    });
  });

  describe("limits", () => {
    it("are 60 uploads an hour per member", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      const key = keys.rateLimit("chat-attach", a.membership.id);
      await withRateLimits(async () => {
        expect((await chat(a).attach(id, PNG)).status).toBe(201);
        expect(await ctx.redis.ttl(key)).toBeGreaterThan(3590);
        await ctx.redis.set(key, "59");
        expect((await chat(a).attach(id, PNG)).status).toBe(201);
        const refused = await chat(a).attach(id, PNG);
        expect(refused.status).toBe(429);
        expect(refused.body.error.code).toBe("RATE_LIMITED");
        expect((await chat(b).attach(id, PNG)).status).toBe(201);
      });
    });

    it("are 200 MB a day per member, as stored and counted before anything is saved", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      const key = keys.rateLimit("chat-attach-bytes", a.membership.id);
      await withRateLimits(async () => {
        const first = await uploadPdf(chat(a), id);
        expect(await ctx.redis.get(key)).toBe(String(Math.ceil(first.size / 1024)));
        expect(await ctx.redis.ttl(key)).toBeGreaterThan(86_390);
        expect(await filesToday(tenant.id)).toBe("1");
        await ctx.redis.set(key, String(200 * 1024));
        const refused = await chat(a).attach(id, PDF, { filename: "b.pdf", contentType: "application/pdf" });
        expect(refused.status).toBe(429);
        expect(await allRows()).toHaveLength(1);
        // Refused by the member's own limit, so the institution's day isn't counted.
        expect(await filesToday(tenant.id)).toBe("1");
      });
    });

    it("are 3000 files a day per institution, all its members together", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      const key = keys.chatFilesDay(tenant.id, new Date().toISOString().slice(0, 10));
      expect((await chat(a).attach(id, PNG)).status).toBe(201);
      expect(await ctx.redis.get(key)).toBe("1");
      // Counted only for a file about to be saved: not for one the bytes refuse.
      expect((await chat(a).attach(id, Buffer.from("not a photo"), { filename: "x.png", contentType: "image/png" })).status).toBe(415);
      expect(await ctx.redis.get(key)).toBe("1");
      await ctx.redis.set(key, "3000");
      const refused = await chat(b).attach(id, PNG);
      expect(refused.status).toBe(429);
      expect(refused.body.error.message).toBe("This institution has reached today's limit on photos and files in chat. Please try again tomorrow.");
      expect(await allRows()).toHaveLength(1);
      // Another institution's day is its own.
      const other: Setup = await setup();
      const otherId = await acceptedThread(ctx, other.tenant.slug, other.a, other.b);
      expect((await other.chat(other.a).attach(otherId, PNG)).status).toBe(201);
    });

    it("are 300 link requests a minute per member", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      const key = keys.rateLimit("chat-file-links", a.membership.id);
      await withRateLimits(async () => {
        expect((await chat(a).links(id, [randomUUID()])).status).toBe(200);
        expect(await ctx.redis.ttl(key)).toBeGreaterThan(55);
        await ctx.redis.set(key, "299");
        expect((await chat(a).links(id, [randomUUID()])).status).toBe(200);
        expect((await chat(a).links(id, [randomUUID()])).status).toBe(429);
      });
    });
  });
});
