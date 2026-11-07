import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { chatAttachments, chatMessages, memberships } from "../../src/db/schema";
import { fileLinkKey, signFileLink, type FileLinkVariant } from "../../src/lib/fileLinks";
import { makeThumbnail } from "../../src/lib/images";
import { runInTransaction } from "../../src/lib/transaction";
import { seedDirectThread } from "../../src/repositories/chat.repo";
import {
  chatAttachmentKeys,
  claimChatAttachments,
  deleteChatAttachmentsByIds,
  deleteUnsentChatAttachmentsOf,
  findChatAttachmentById,
  findChatAttachmentsByMessageIds,
  insertChatAttachment,
  lockChatAttachmentsForClaim,
  lockUnsentChatAttachmentsBefore,
  summarizeChatAttachments,
  withheldAndUnsentChatAttachmentKeysOf,
  type ChatAttachmentInsert,
  type ChatAttachmentRow,
} from "../../src/repositories/chatAttachments.repo";
import { LocalPrivateStorage, S3PrivateStorage } from "../../src/services/storage";
import { privateCopy } from "../../src/services/storage/PrivateStorage";
import { capturingLogger } from "../helpers/capturingLogger";
import { bareMember } from "../helpers/chat";
import { createTenant } from "../helpers/factories";
import { testPng } from "../helpers/images";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();
const PNG = await testPng(64, 48);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n", "latin1");

/** Postgres's error code for a failed query, which Drizzle wraps. */
async function pgCode(promise: Promise<unknown>): Promise<string | undefined> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e as { code?: string; cause?: { code?: string } },
  );
  return err?.cause?.code ?? err?.code;
}

describe.skipIf(!dbAvailable)("chat files in private storage", () => {
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

  /** An accepted thread between two members, with three messages. */
  async function thread() {
    const { tenant } = await createTenant(ctx);
    const a = await bareMember(ctx, tenant.id);
    const b = await bareMember(ctx, tenant.id);
    const at = (ago: number) => new Date(Date.now() - ago);
    const messages = await runInTransaction(ctx, (tx) =>
      seedDirectThread(tx, {
        tenantId: tenant.id,
        aId: a.id,
        bId: b.id,
        requesterId: a.id,
        state: "ACCEPTED",
        messages: [
          { senderId: a.id, body: "Here are the photos", at: at(3000) },
          { senderId: b.id, body: "Thanks", at: at(2000) },
          { senderId: a.id, body: "And the form", at: at(1000) },
        ],
      }),
    );
    return { tenant, a, b, conversationId: messages[0]!.conversationId, messages };
  }
  type Thread = Awaited<ReturnType<typeof thread>>;

  /** Stores a photo and its thumbnail as the upload route will, unsent. */
  async function storePhoto(t: Thread, uploaderId: string, extra: Partial<ChatAttachmentInsert> = {}): Promise<ChatAttachmentRow> {
    const thumb = await makeThumbnail(PNG);
    const { key: storageKey } = await ctx.privateStorage.save({ tenantId: t.tenant.id, buffer: PNG, mime: "image/png", fileName: null });
    const { key: thumbKey } = await ctx.privateStorage.save({ tenantId: t.tenant.id, buffer: thumb.buffer, mime: "image/webp", fileName: null });
    return insertChatAttachment(ctx.db, { tenantId: t.tenant.id, conversationId: t.conversationId, uploaderMembershipId: uploaderId, kind: "PHOTO", storageKey, thumbKey, contentType: "image/png", byteSize: PNG.length, width: 64, height: 48, ...extra });
  }

  async function storePdf(t: Thread, uploaderId: string, fileName = "notes.pdf", extra: Partial<ChatAttachmentInsert> = {}): Promise<ChatAttachmentRow> {
    const { key: storageKey } = await ctx.privateStorage.save({ tenantId: t.tenant.id, buffer: PDF, mime: "application/pdf", fileName });
    return insertChatAttachment(ctx.db, { tenantId: t.tenant.id, conversationId: t.conversationId, uploaderMembershipId: uploaderId, kind: "FILE", storageKey, contentType: "application/pdf", byteSize: PDF.length, fileName, ...extra });
  }

  /** The path of a member's link to one copy. */
  async function linkPath(row: ChatAttachmentRow, variant: FileLinkVariant): Promise<string> {
    const copy = privateCopy(row, variant) ?? privateCopy(row, "full")!;
    const url = await ctx.privateStorage.link({ attachmentId: row.id, key: copy.key, variant, contentType: copy.contentType, ttlSec: 600 });
    expect(url.startsWith(`${ctx.config.PUBLIC_BASE_URL}/files/`)).toBe(true);
    return new URL(url).pathname;
  }

  const get = (path: string) => request(ctx.app).get(path).buffer(true);

  function expectPrivateHeaders(headers: Record<string, string>) {
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["cache-control"]).toBe("private, no-store");
    expect(headers["content-security-policy"]).toBe("default-src 'none'; sandbox");
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers.etag).toBeUndefined();
    expect(headers["last-modified"]).toBeUndefined();
  }

  describe("/files/:token", () => {
    it("serves a photo, its thumbnail and its download with headers that keep them private", async () => {
      const t = await thread();
      const photo = await storePhoto(t, t.a.id);

      const full = await get(await linkPath(photo, "full"));
      expect(full.status).toBe(200);
      expect(full.headers["content-type"]).toBe("image/png");
      expect(full.headers["content-disposition"]).toBe("inline");
      expect(Buffer.compare(full.body as Buffer, PNG)).toBe(0);
      expectPrivateHeaders(full.headers);

      const thumb = await get(await linkPath(photo, "thumb"));
      expect(thumb.status).toBe(200);
      expect(thumb.headers["content-type"]).toBe("image/webp");
      expect(thumb.headers["content-disposition"]).toBe("inline");
      expect((thumb.body as Buffer).subarray(8, 12).toString("ascii")).toBe("WEBP");
      expectPrivateHeaders(thumb.headers);

      const download = await get(await linkPath(photo, "download"));
      expect(download.status).toBe(200);
      expect(download.headers["content-disposition"]).toBe(`attachment; filename="photo.png"; filename*=UTF-8''photo.png`);
      expectPrivateHeaders(download.headers);

      const head = await request(ctx.app).head(await linkPath(photo, "full"));
      expect(head.status).toBe(200);
      expect(head.headers["content-length"]).toBe(String(PNG.length));
      expectPrivateHeaders(head.headers);
    });

    it("always sends a PDF as a download under its name, which its link never shows", async () => {
      const t = await thread();
      const name = "Résumé – Meera.pdf";
      const pdf = await storePdf(t, t.a.id, name);
      for (const variant of ["full", "download"] as const) {
        const path = await linkPath(pdf, variant);
        expect(path).not.toMatch(/sum|Meera|pdf/i);
        const res = await get(path);
        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toBe("application/pdf");
        expect(res.headers["content-disposition"]).toBe(`attachment; filename="Resume _ Meera.pdf"; filename*=UTF-8''R%C3%A9sum%C3%A9%20%E2%80%93%20Meera.pdf`);
        expect(res.headers["content-length"]).toBe(String(PDF.length));
        expectPrivateHeaders(res.headers);
      }
      // A file has no thumbnail.
      const token = signFileLink(fileLinkKey(ctx.config), { attachmentId: pdf.id, variant: "thumb", expiresAt: Math.floor(Date.now() / 1000) + 600 });
      expect((await get(`/files/${token}`)).status).toBe(404);
    });

    it("refuses a changed, expired or foreign link with 403, before looking anything up", async () => {
      const t = await thread();
      const photo = await storePhoto(t, t.a.id);
      const path = await linkPath(photo, "full");
      const changed = `${path.slice(0, -1)}${path.endsWith("A") ? "B" : "A"}`;
      const expired = `/files/${signFileLink(fileLinkKey(ctx.config), { attachmentId: photo.id, variant: "full", expiresAt: Math.floor(Date.now() / 1000) - 1 })}`;
      const foreign = `/files/${signFileLink("another-key-another-key-another-key", { attachmentId: photo.id, variant: "full", expiresAt: Math.floor(Date.now() / 1000) + 600 })}`;
      for (const refused of [changed, expired, foreign, "/files/not-a-token", "/files/a.b"]) {
        const res = await get(refused);
        expect(res.status, refused).toBe(403);
        expect(res.body.error).toEqual({ code: "FORBIDDEN", message: "This link has expired" });
        expect(res.headers["content-disposition"]).toBeUndefined();
      }
    });

    it("stops opening an attachment the moment its row goes, and says 404 for a file that is missing", async () => {
      const t = await thread();
      const photo = await storePhoto(t, t.a.id);
      const pdf = await storePdf(t, t.a.id);
      const photoPath = await linkPath(photo, "full");
      const pdfPath = await linkPath(pdf, "download");
      expect((await get(photoPath)).status).toBe(200);

      await runInTransaction(ctx, (tx) => deleteChatAttachmentsByIds(tx, [photo.id]));
      const gone = await get(photoPath);
      expect(gone.status).toBe(404);
      expect(gone.body.error.code).toBe("NOT_FOUND");

      await unlink(join(ctx.config.privateUploadDirAbsolute, pdf.storageKey));
      const missing = await get(pdfPath);
      expect(missing.status).toBe(404);
      // The error goes out as JSON, not labelled as the PDF it isn't.
      expect(missing.headers["content-type"]).toMatch(/^application\/json/);
      expect(missing.headers["content-disposition"]).toBeUndefined();
    });

    it("gives nothing away to a path that tries to climb out", async () => {
      const t = await thread();
      const photo = await storePhoto(t, t.a.id);
      const valid = await linkPath(photo, "full");
      for (const path of [
        "/files/..%2F..%2F.env.test",
        "/files/%2e%2e%2f%2e%2e%2fpackage.json",
        "/files/../.env.test",
        "/files/..%5C..%5C.env.test",
        `${valid}/../../package.json`,
        `${valid}%2F..%2F..%2Fpackage.json`,
        "/files/",
        "/files",
      ]) {
        const res = await get(path);
        expect([403, 404], path).toContain(res.status);
        expect(res.text, path).not.toMatch(/JWT_SECRET|DATABASE_URL|"name": "@illuminize/);
        expect(res.headers["content-disposition"], path).toBeUndefined();
      }

      // A row whose key points anywhere else is refused even with a good link. This storage has a root of its own, with a
      // file beside it and a loose one inside it, which the route would serve without its key check, whatever
      // PRIVATE_UPLOAD_DIR is.
      const outside = await mkdtemp(join(tmpdir(), "illuminize-files-"));
      try {
        const secret = `outside the private area ${randomUUID()}`;
        const root = join(outside, "private");
        await mkdir(join(root, t.tenant.id), { recursive: true });
        await writeFile(join(outside, "secret.pdf"), secret);
        await writeFile(join(root, t.tenant.id, "loose.pdf"), secret);
        const app = createApp({ ...ctx, privateStorage: new LocalPrivateStorage(root, ctx.config.PUBLIC_BASE_URL, fileLinkKey(ctx.config)) });
        for (const storageKey of ["../secret.pdf", `${t.tenant.id}/../../secret.pdf`, `${t.tenant.id}\\..\\..\\secret.pdf`, `${t.tenant.id}/loose.pdf`]) {
          const [crafted] = await ctx.db
            .insert(chatAttachments)
            .values({ tenantId: t.tenant.id, conversationId: t.conversationId, uploaderMembershipId: t.a.id, kind: "FILE", storageKey, contentType: "application/pdf", byteSize: 10, fileName: "x.pdf" })
            .returning();
          const token = signFileLink(fileLinkKey(ctx.config), { attachmentId: crafted!.id, variant: "full", expiresAt: Math.floor(Date.now() / 1000) + 600 });
          const res = await request(app).get(`/files/${token}`).buffer(true);
          expect(res.status, storageKey).toBe(404);
          expect(res.headers["content-type"], storageKey).toMatch(/^application\/json/);
          expect(JSON.stringify(res.body), storageKey).not.toContain(secret);
        }
      } finally {
        await rm(outside, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      }
    });

    it("answers 404 when files are on S3, whose links are presigned on the bucket", async () => {
      const t = await thread();
      const photo = await storePhoto(t, t.a.id);
      const path = await linkPath(photo, "full");
      const s3 = new S3PrivateStorage({ bucket: "illuminize-private", region: "us-east-1", forcePathStyle: true, credentials: { accessKeyId: "a", secretAccessKey: "b" } });
      const app = createApp({ ...ctx, privateStorage: s3 });
      const res = await request(app).get(path);
      expect(res.status).toBe(404);
      expect(ctx.privateStorage).toBeInstanceOf(LocalPrivateStorage);
    });

    it("keeps link tokens out of the request log", async () => {
      const t = await thread();
      const photo = await storePhoto(t, t.a.id);
      const path = await linkPath(photo, "full");
      const token = path.slice("/files/".length);
      const { logger, text } = capturingLogger();
      // The request log is off in tests; this app has it, as the API does.
      const app = createApp({ ...ctx, logger, config: { ...ctx.config, isTest: false } });
      expect((await request(app).get(path)).status).toBe(200);
      expect((await request(app).get(`${path}x`)).status).toBe(403);
      expect((await request(app).get(`/FILES/${token}?x=1`)).status).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const logged = text();
      expect(logged.match(/"url":"\/files\/…/g)?.length).toBe(3);
      expect(logged).toContain('"url":"/files/…?x=1"');
      for (const part of token.split(".")) expect(logged).not.toContain(part.slice(0, 16));
    });

    it("keeps link tokens out of the error handler's log lines", async () => {
      const t = await thread();
      const photo = await storePhoto(t, t.a.id);
      const path = await linkPath(photo, "full");
      const token = path.slice("/files/".length);
      /** The database, failing the attachment's lookup with this error. */
      const failingDb = (err: Error) =>
        new Proxy(ctx.db, {
          get: (target, prop, receiver) =>
            prop === "select"
              ? () => {
                  throw err;
                }
              : Reflect.get(target, prop, receiver),
        });
      for (const { err, status, msg } of [
        { err: new Error("The disk went away"), status: 500, msg: "Unhandled error" },
        { err: Object.assign(new Error("duplicate key value"), { code: "23505", constraint: "chat_attachments_pkey" }), status: 409, msg: "Unique constraint conflict" },
        { err: Object.assign(new Error("canceling statement due to lock timeout"), { code: "55P03" }), status: 503, msg: "Gave up waiting for a row lock" },
      ]) {
        const { logger, text } = capturingLogger();
        const app = createApp({ ...ctx, logger, db: failingDb(err), config: { ...ctx.config, isTest: false } });
        const res = await request(app).get(path);
        expect(res.status, msg).toBe(status);
        expect(res.headers["content-disposition"], msg).toBeUndefined();
        await new Promise((resolve) => setTimeout(resolve, 50));
        const logged = text();
        const entries = logged
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as { msg?: string; url?: string });
        expect(entries.find((e) => e.msg === msg)?.url, msg).toBe("/files/…");
        for (const part of token.split(".")) expect(logged, msg).not.toContain(part.slice(0, 16));
      }
    });
  });

  describe("the attachments ledger", () => {
    it("claims a member's own unsent uploads in this conversation, in the order the send gives", async () => {
      const t = await thread();
      const first = await storePhoto(t, t.a.id);
      const second = await storePdf(t, t.a.id, "form.pdf");
      const third = await storePhoto(t, t.a.id);
      const theirs = await storePhoto(t, t.b.id);
      const elsewhere = await thread();
      const otherConversation = await storePhoto(elsewhere, t.a.id);
      const message = t.messages[2]!;
      // A message whose attachments are in send order, which isn't the order they were uploaded or their ids'.
      const order = [third.id, first.id, second.id];

      const claimed = await runInTransaction(ctx, async (tx) => {
        const locked = await lockChatAttachmentsForClaim(tx, { ids: [...order, theirs.id, otherConversation.id], conversationId: t.conversationId, uploaderMembershipId: t.a.id });
        expect(locked.map((r) => r.id).sort()).toEqual([...order].sort());
        return claimChatAttachments(tx, { ids: order, messageId: message.id });
      });
      expect(claimed).toHaveLength(3);
      const rows = await findChatAttachmentsByMessageIds(ctx.db, [message.id, t.messages[0]!.id]);
      expect(rows.map((r) => [r.id, r.position])).toEqual([
        [third.id, 0],
        [first.id, 1],
        [second.id, 2],
      ]);
      expect(rows.every((r) => r.messageId === message.id)).toBe(true);

      // Sent ones can't be claimed again, by this message or another.
      await runInTransaction(ctx, async (tx) => {
        expect(await lockChatAttachmentsForClaim(tx, { ids: order, conversationId: t.conversationId, uploaderMembershipId: t.a.id })).toEqual([]);
        expect(await claimChatAttachments(tx, { ids: order, messageId: t.messages[0]!.id })).toEqual([]);
      });
      expect((await findChatAttachmentById(ctx.db, theirs.id))!.messageId).toBeNull();
      expect(await findChatAttachmentsByMessageIds(ctx.db, [])).toEqual([]);
    });

    it("sums up each message's photos and files for the conversation list", async () => {
      const t = await thread();
      const [m1, m2, m3] = [t.messages[0]!, t.messages[1]!, t.messages[2]!];
      const ids = { photos: [await storePhoto(t, t.a.id), await storePhoto(t, t.a.id)], files: [await storePdf(t, t.a.id, "b.pdf"), await storePdf(t, t.a.id, "a.pdf")], one: await storePdf(t, t.b.id, "only.pdf") };
      await runInTransaction(ctx, async (tx) => {
        await claimChatAttachments(tx, { ids: [ids.photos[0]!.id, ids.files[0]!.id, ids.photos[1]!.id, ids.files[1]!.id], messageId: m1.id });
        await claimChatAttachments(tx, { ids: [ids.one.id], messageId: m2.id });
      });
      const summary = await summarizeChatAttachments(ctx.db, [m1.id, m2.id, m3.id]);
      expect(summary.get(m1.id)).toEqual({ photos: 2, files: 2, fileName: "b.pdf" });
      expect(summary.get(m2.id)).toEqual({ photos: 0, files: 1, fileName: "only.pdf" });
      expect(summary.has(m3.id)).toBe(false);
      expect((await summarizeChatAttachments(ctx.db, [])).size).toBe(0);
    });

    it("holds each kind to its shape", async () => {
      const t = await thread();
      const base = { tenantId: t.tenant.id, conversationId: t.conversationId, uploaderMembershipId: t.a.id };
      const key = (ext: string) => `${t.tenant.id}/${randomUUID()}.${ext}`;
      expect(await pgCode(insertChatAttachment(ctx.db, { ...base, kind: "PHOTO", storageKey: key("png"), contentType: "image/png", byteSize: 10, width: 1, height: 1 }))).toBe("23514");
      expect(await pgCode(insertChatAttachment(ctx.db, { ...base, kind: "PHOTO", storageKey: key("png"), thumbKey: key("webp"), contentType: "image/png", byteSize: 10 }))).toBe("23514");
      expect(await pgCode(insertChatAttachment(ctx.db, { ...base, kind: "FILE", storageKey: key("pdf"), contentType: "application/pdf", byteSize: 10 }))).toBe("23514");
      expect(await pgCode(insertChatAttachment(ctx.db, { ...base, kind: "FILE", storageKey: key("pdf"), thumbKey: key("webp"), contentType: "application/pdf", byteSize: 10, fileName: "a.pdf" }))).toBe("23514");
      expect(await pgCode(insertChatAttachment(ctx.db, { ...base, kind: "FILE", storageKey: key("pdf"), contentType: "application/pdf", byteSize: 0, fileName: "a.pdf" }))).toBe("23514");
      const pdf = await storePdf(t, t.a.id);
      expect(await pgCode(insertChatAttachment(ctx.db, { ...base, kind: "FILE", storageKey: pdf.storageKey, contentType: "application/pdf", byteSize: 10, fileName: "b.pdf" }))).toBe("23505");
      // An upload starts unsent whatever it is given.
      const unsent = await storePdf(t, t.a.id, "c.pdf", { messageId: t.messages[0]!.id });
      expect(unsent.messageId).toBeNull();
    });

    it("hands the sweep old unsent uploads only, skipping any a send holds", async () => {
      const t = await thread();
      const hourAgo = new Date(Date.now() - 3_600_000);
      const day = new Date(Date.now() - 25 * 3_600_000);
      const oldA = await storePhoto(t, t.a.id, { createdAt: day });
      const oldB = await storePdf(t, t.a.id, "old.pdf", { createdAt: new Date(day.getTime() - 1000) });
      const recent = await storePhoto(t, t.a.id);
      const sent = await storePdf(t, t.a.id, "sent.pdf", { createdAt: day });
      await runInTransaction(ctx, (tx) => claimChatAttachments(tx, { ids: [sent.id], messageId: t.messages[0]!.id }));

      await runInTransaction(ctx, async (send) => {
        expect(await lockChatAttachmentsForClaim(send, { ids: [oldA.id], conversationId: t.conversationId, uploaderMembershipId: t.a.id })).toHaveLength(1);
        const swept = await runInTransaction(ctx, (sweep) => lockUnsentChatAttachmentsBefore(sweep, hourAgo, 10));
        expect(swept.map((r) => r.id)).toEqual([oldB.id]);
      });
      const swept = await runInTransaction(ctx, async (tx) => {
        const rows = await lockUnsentChatAttachmentsBefore(tx, hourAgo, 10);
        await deleteChatAttachmentsByIds(tx, rows.map((r) => r.id));
        return rows;
      });
      expect(swept.map((r) => r.id)).toEqual([oldB.id, oldA.id]);
      expect(swept.flatMap(chatAttachmentKeys)).toEqual([oldB.storageKey, oldA.storageKey, oldA.thumbKey]);
      expect(await findChatAttachmentById(ctx.db, recent.id)).toBeDefined();
      expect(await findChatAttachmentById(ctx.db, sent.id)).toBeDefined();
      expect(await findChatAttachmentById(ctx.db, oldA.id)).toBeUndefined();
    });

    it("finds what a leaving member uploaded that nobody received, and clears their unsent ones", async () => {
      const t = await thread();
      const [m1, m2, m3] = t.messages;
      const unsent = await storePhoto(t, t.a.id);
      const withheld = await storePdf(t, t.a.id, "withheld.pdf");
      const sent = await storePhoto(t, t.a.id);
      const theirs = await storePhoto(t, t.b.id);
      await runInTransaction(ctx, async (tx) => {
        await claimChatAttachments(tx, { ids: [withheld.id], messageId: m3!.id });
        await claimChatAttachments(tx, { ids: [sent.id], messageId: m1!.id });
        await claimChatAttachments(tx, { ids: [theirs.id], messageId: m2!.id });
      });
      await ctx.db.update(chatMessages).set({ withheld: true }).where(eq(chatMessages.id, m3!.id));

      const keys = await withheldAndUnsentChatAttachmentKeysOf(ctx.db, [t.a.id]);
      expect(keys.sort()).toEqual([unsent.storageKey, unsent.thumbKey!, withheld.storageKey].sort());
      expect(await withheldAndUnsentChatAttachmentKeysOf(ctx.db, [])).toEqual([]);

      await runInTransaction(ctx, (tx) => deleteUnsentChatAttachmentsOf(tx, [t.a.id]));
      expect(await findChatAttachmentById(ctx.db, unsent.id)).toBeUndefined();
      expect(await findChatAttachmentById(ctx.db, withheld.id)).toBeDefined();
      // A withheld message's attachments go with it.
      await ctx.db.delete(chatMessages).where(eq(chatMessages.id, m3!.id));
      expect(await findChatAttachmentById(ctx.db, withheld.id)).toBeUndefined();
      // A sent one outlives its sender's membership.
      await ctx.db.delete(memberships).where(eq(memberships.id, t.a.id));
      expect(await findChatAttachmentById(ctx.db, sent.id)).toMatchObject({ uploaderMembershipId: null, messageId: m1!.id });
    });
  });
});
