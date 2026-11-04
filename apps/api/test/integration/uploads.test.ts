import { eq } from "drizzle-orm";
import sharp from "sharp";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { uploads } from "../../src/db/schema";
import { S3Storage } from "../../src/services/storage";
import { CAMERA_MAKE, CORRUPT_PNG, GPS_MARKER, cameraJpeg, testPng } from "../helpers/images";
import { createTenant, memberSession } from "../helpers/factories";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();
const PNG = await testPng();

describe.skipIf(!dbAvailable)("image uploads", () => {
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
    const { tenant } = await createTenant(ctx);
    const member = await memberSession(ctx, tenant.id);
    const send = (file: Buffer, opts: { purpose?: string; filename?: string; contentType?: string } = {}) =>
      api()
        .post(`/api/v1/t/${tenant.slug}/uploads${opts.purpose ? `?purpose=${opts.purpose}` : ""}`)
        .set(member.headers)
        .attach("file", file, { filename: opts.filename ?? "a.png", contentType: opts.contentType ?? "image/png" });
    /** The stored file as served, with what sharp reads from it. */
    const fetchStored = async (url: string) => {
      const res = await api().get(new URL(url).pathname).buffer(true);
      const body = res.body as Buffer;
      return { res, body, meta: await sharp(body).metadata() };
    };
    return { tenant, member, send, fetchStored };
  }

  it("stores valid images, serves them back and records each in the ledger", async () => {
    const { tenant, member, send, fetchStored } = await setup();
    const res = await send(PNG);
    expect(res.status).toBe(201);
    expect(res.body.data.url).toMatch(new RegExp(`/uploads/${tenant.id}/[0-9a-f-]+\\.png$`));
    const { res: served, body, meta } = await fetchStored(res.body.data.url);
    expect(served.status).toBe(200);
    expect(served.headers["content-type"]).toContain("image/png");
    expect(meta).toMatchObject({ format: "png", width: 64, height: 48 });

    const key = ctx.storage.keyFromUrl(res.body.data.url)!;
    const [row] = await ctx.db.select().from(uploads).where(eq(uploads.storageKey, key));
    expect(row).toMatchObject({ tenantId: tenant.id, userId: member.user.id, purpose: "image", contentType: "image/png", byteSize: body.length });

    await send(PNG);
    expect(await ctx.db.select().from(uploads)).toHaveLength(2);
  });

  it("turns photos upright and strips their metadata, GPS position included", async () => {
    const { send, fetchStored } = await setup();
    const photo = await cameraJpeg();
    // The fixture really carries what must go.
    expect(await sharp(photo).metadata()).toMatchObject({ width: 80, height: 40, orientation: 6 });
    expect(photo.includes(GPS_MARKER)).toBe(true);
    expect(photo.includes(CAMERA_MAKE)).toBe(true);

    const res = await send(photo, { filename: "photo.jpg", contentType: "image/jpeg" });
    expect(res.status).toBe(201);
    expect(res.body.data.url).toMatch(/\.jpg$/);
    const { body, meta } = await fetchStored(res.body.data.url);
    expect(meta).toMatchObject({ format: "jpeg", width: 40, height: 80 });
    expect(meta.orientation).toBeUndefined();
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(meta.iptc).toBeUndefined();
    expect(body.includes(GPS_MARKER)).toBe(false);
    expect(body.includes(CAMERA_MAKE)).toBe(false);
  });

  it("scales images down to 2048 on the longest side, never up", async () => {
    const { send, fetchStored } = await setup();
    const wide = await sharp({ create: { width: 3000, height: 1000, channels: 3, background: "#336699" } }).png().toBuffer();
    const big = await send(wide);
    expect((await fetchStored(big.body.data.url)).meta).toMatchObject({ width: 2048, height: 683 });
    const small = await send(await testPng(30, 20));
    expect((await fetchStored(small.body.data.url)).meta).toMatchObject({ width: 30, height: 20 });
  });

  it("crops an avatar to a 512×512 JPEG on white and records its purpose", async () => {
    const { member, send, fetchStored } = await setup();
    const res = await send(await testPng(300, 120), { purpose: "avatar" });
    expect(res.status).toBe(201);
    expect(res.body.data.url).toMatch(/\.jpg$/);
    const { res: served, body, meta } = await fetchStored(res.body.data.url);
    expect(served.headers["content-type"]).toContain("image/jpeg");
    expect(meta).toMatchObject({ format: "jpeg", width: 512, height: 512, hasAlpha: false });
    // The half-transparent blue sits on white, so it comes out lighter than the blue itself.
    const { data } = await sharp(body).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(100);

    const [row] = await ctx.db.select().from(uploads).where(eq(uploads.storageKey, ctx.storage.keyFromUrl(res.body.data.url)!));
    expect(row).toMatchObject({ userId: member.user.id, purpose: "avatar", contentType: "image/jpeg" });

    // A tiny, very narrow image is cropped before it is enlarged: enlarged whole, it would take seconds of every core.
    const strip = await sharp({ create: { width: 1, height: 4000, channels: 3, background: "#336699" } }).png().toBuffer();
    const started = performance.now();
    const narrow = await send(strip, { purpose: "avatar" });
    expect(performance.now() - started).toBeLessThan(2000);
    expect(narrow.status).toBe(201);
    expect((await fetchStored(narrow.body.data.url)).meta).toMatchObject({ format: "jpeg", width: 512, height: 512 });
  });

  it("refuses files that don't decode, oversized images and unknown purposes, and records none of them", async () => {
    const { send } = await setup();
    const corrupt = await send(CORRUPT_PNG);
    expect(corrupt.status).toBe(415);
    expect(corrupt.body.error.code).toBe("UNSUPPORTED_MEDIA");

    // 42 megapixels in a small file: refused from its header, before it is decoded.
    const bomb = await sharp({ create: { width: 7000, height: 6000, channels: 3, background: "#000000" } }).png({ compressionLevel: 9 }).toBuffer();
    const tooBig = await send(bomb);
    expect(tooBig.status).toBe(413);
    expect(tooBig.body.error.code).toBe("PAYLOAD_TOO_LARGE");

    const badPurpose = await send(PNG, { purpose: "banner" });
    expect(badPurpose.status).toBe(400);
    expect(badPurpose.body.error.code).toBe("VALIDATION_ERROR");
    expect(await ctx.db.select().from(uploads)).toHaveLength(0);
  });

  it("rejects non-images and spoofed content types", async () => {
    const { tenant } = await createTenant(ctx);
    const member = await memberSession(ctx, tenant.id);
    const base = `/api/v1/t/${tenant.slug}/uploads`;
    const text = await api().post(base).set(member.headers).attach("file", Buffer.from("hello"), { filename: "a.txt", contentType: "text/plain" });
    expect(text.status).toBe(415);
    const spoof = await api().post(base).set(member.headers).attach("file", Buffer.alloc(64, 7), { filename: "a.png", contentType: "image/png" });
    expect(spoof.status).toBe(415);
    expect(spoof.body.error.code).toBe("UNSUPPORTED_MEDIA");
    const missing = await api().post(base).set(member.headers);
    expect(missing.status).toBe(400);
  });

  it("deletes the stored file when the ledger can't record it", async () => {
    const { tenant, send } = await setup();
    const first = await send(PNG);
    const takenKey = ctx.storage.keyFromUrl(first.body.data.url)!;
    // A provider that hands back a key the ledger already holds, so recording the upload fails.
    const deleted: string[] = [];
    const previous = ctx.storage;
    ctx.storage = {
      name: "colliding",
      save: async () => ({ key: takenKey, url: `https://files.example.com/${takenKey}` }),
      delete: async (key) => void deleted.push(key),
      keyFromUrl: () => null,
    };
    try {
      const res = await send(PNG);
      expect(res.status).toBe(409); // the duplicate key, as the error handler reports one
      expect(deleted).toEqual([takenKey]);
      expect(await ctx.db.select().from(uploads).where(eq(uploads.tenantId, tenant.id))).toHaveLength(1);
    } finally {
      ctx.storage = previous;
    }
  });

  it("stores uploads in S3-compatible storage when configured", async () => {
    const commands: Array<{ constructor: { name: string }; input: { Key: string; ContentType?: string; Body?: Buffer } }> = [];
    const s3 = new S3Storage({ bucket: "photos", region: "auto", forcePathStyle: true, publicBaseUrl: "https://photos.example.com" }, {
      send: async (c: never) => void commands.push(c),
    } as never);
    const previous = ctx.storage;
    ctx.storage = s3;
    try {
      const { tenant, send } = await setup();
      const res = await send(PNG, { purpose: "avatar" });
      expect(res.status).toBe(201);
      expect(res.body.data.url).toMatch(new RegExp(`^https://photos\\.example\\.com/${tenant.id}/[0-9a-f-]+\\.jpg$`));
      expect(commands).toHaveLength(1);
      expect(commands[0]!.input.ContentType).toBe("image/jpeg");
      expect((await sharp(commands[0]!.input.Body!).metadata()).width).toBe(512);
      const [row] = await ctx.db.select().from(uploads);
      expect(row).toMatchObject({ storageKey: commands[0]!.input.Key, purpose: "avatar" });
    } finally {
      ctx.storage = previous;
    }
  });
});
