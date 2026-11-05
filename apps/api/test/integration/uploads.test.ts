import { IMAGE_SIZE_PROBLEM, MAX_UPLOAD_BYTES } from "@illuminize/shared";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { uploads } from "../../src/db/schema";
import { keys } from "../../src/redis/keys";
import { S3Storage } from "../../src/services/storage";
import { CAMERA_MAKE, CORRUPT_PNG, GPS_MARKER, HEIC_START, cameraJpeg, testAvif, testPng } from "../helpers/images";
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

  it("decides by the bytes, not the type a phone or browser declares", async () => {
    const { send, fetchStored } = await setup();
    // Android labels a photo it saved as JPEG with its source's type.
    const converted = await send(await cameraJpeg(), { filename: "IMG_0001.HEIC", contentType: "image/heic" });
    expect(converted.status).toBe(201);
    expect(converted.body.data.url).toMatch(/\.jpg$/);
    expect((await fetchStored(converted.body.data.url)).meta).toMatchObject({ format: "jpeg", width: 40, height: 80 });
    const [row] = await ctx.db.select().from(uploads).where(eq(uploads.storageKey, ctx.storage.keyFromUrl(converted.body.data.url)!));
    expect(row?.contentType).toBe("image/jpeg");
    // A browser sends a file it can't name as octet-stream.
    expect((await send(PNG, { filename: "photo", contentType: "application/octet-stream" })).status).toBe(201);

    // HEIC can't be decoded here, so the apps convert it first; whatever it is called, it is refused by its bytes.
    for (const contentType of ["image/heic", "image/jpeg"]) {
      const heic = await send(HEIC_START, { filename: "IMG_0002.HEIC", contentType });
      expect(heic.status, contentType).toBe(415);
      expect(heic.body.error.code).toBe("UNSUPPORTED_MEDIA");
    }
    // So is HEIF the server could decode (AVIF): only JPEG, PNG and WebP are stored.
    expect((await send(await testAvif(), { filename: "a.avif", contentType: "image/avif" })).status).toBe(415);
    // A declared non-image is still turned away before it is read.
    const pdf = await send(Buffer.from("%PDF-1.7\n"), { filename: "cv.pdf", contentType: "application/pdf" });
    expect(pdf.status).toBe(415);
    expect(pdf.body.error.code).toBe("UNSUPPORTED_MEDIA");
    expect(await ctx.db.select().from(uploads)).toHaveLength(2);
  });

  it("refuses a file over 5 MB in the apps' words, and records nothing", async () => {
    const { send } = await setup();
    const big = await send(Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0xff), { filename: "big.jpg", contentType: "image/jpeg" });
    expect(big.status).toBe(413);
    expect(big.body.error).toMatchObject({ code: "PAYLOAD_TOO_LARGE", message: IMAGE_SIZE_PROBLEM });
    expect(big.body.error.message).toBe("Choose an image under 5 MB.");
    // One at the limit is read, and then judged by its bytes.
    const atLimit = await send(Buffer.alloc(MAX_UPLOAD_BYTES, 0xff), { filename: "big.jpg", contentType: "image/jpeg" });
    expect(atLimit.status).toBe(415);
    expect(await ctx.db.select().from(uploads)).toHaveLength(0);
  });

  it("counts refused files against the limits, which run before the file is read", async () => {
    const previous = process.env.RATE_LIMIT_IN_TESTS;
    process.env.RATE_LIMIT_IN_TESTS = "1";
    try {
      const { tenant, member, send } = await setup();
      const today = () => new Date().toISOString().slice(0, 10);
      const days = new Set([today()]);
      await ctx.redis.set(keys.rateLimit("uploads", member.user.id), "17", "EX", 3600);

      const pdf = await send(Buffer.from("%PDF-1.7\n"), { filename: "cv.pdf", contentType: "application/pdf" });
      expect(pdf.status).toBe(415);
      expect(pdf.headers["x-ratelimit-remaining"]).toBe("2");
      const big = await send(Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0xff), { filename: "big.jpg", contentType: "image/jpeg" });
      expect(big.status).toBe(413);
      expect(big.headers["x-ratelimit-remaining"]).toBe("1");
      expect((await send(PNG)).status).toBe(201);
      const over = await send(PNG);
      expect(over.status).toBe(429);
      expect(over.body.error.code).toBe("RATE_LIMITED");

      // The institution's daily count took the three the member's limit let through.
      days.add(today());
      let counted = 0;
      for (const day of days) counted += Number((await ctx.redis.get(keys.uploadsDay(tenant.id, day))) ?? 0);
      expect(counted).toBe(3);
    } finally {
      if (previous === undefined) delete process.env.RATE_LIMIT_IN_TESTS;
      else process.env.RATE_LIMIT_IN_TESTS = previous;
    }
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
