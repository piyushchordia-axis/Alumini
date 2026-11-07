import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeleteObjectCommand, type GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { linkUrlSchema } from "@illuminize/shared";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/env";
import { createPrivateStorage, createStorage, LocalDiskStorage, LocalPrivateStorage, S3PrivateStorage, S3Storage } from "../../src/services/storage";
import { linkDispositionOverride, PRIVATE_KEY_PATTERN, privateCopy, privateFileDisposition } from "../../src/services/storage/PrivateStorage";

const TENANT = "4f0f7c1e-2b7a-4d7a-9a3e-2f4d5c6b7a81";

/** Records every command instead of calling S3. */
function fakeS3() {
  const commands: unknown[] = [];
  return { commands, client: { send: async (cmd: unknown) => void commands.push(cmd) } as never };
}

describe("S3 storage", () => {
  it("puts immutable objects under the tenant and returns the public URL", async () => {
    const s3 = fakeS3();
    const storage = new S3Storage({ bucket: "alumni-photos", region: "auto", forcePathStyle: false, publicBaseUrl: "https://cdn.example.com/" }, s3.client);
    const saved = await storage.save({ tenantId: TENANT, buffer: Buffer.from("png"), mime: "image/png", extension: "png" });
    expect(saved.key).toMatch(new RegExp(`^${TENANT}/[0-9a-f-]{36}\\.png$`));
    expect(saved.url).toBe(`https://cdn.example.com/${saved.key}`);
    const put = s3.commands[0] as PutObjectCommand;
    expect(put).toBeInstanceOf(PutObjectCommand);
    expect(put.input).toMatchObject({ Bucket: "alumni-photos", Key: saved.key, ContentType: "image/png", CacheControl: "public, max-age=31536000, immutable" });
    expect(put.input.ACL).toBeUndefined();

    expect(storage.keyFromUrl(saved.url)).toBe(saved.key);
    expect(storage.keyFromUrl("https://elsewhere.example.com/x.png")).toBeNull();
    await storage.delete(saved.key);
    expect(s3.commands[1]).toBeInstanceOf(DeleteObjectCommand);
    expect((s3.commands[1] as DeleteObjectCommand).input).toEqual({ Bucket: "alumni-photos", Key: saved.key });
    await expect(storage.delete("../../etc/passwd")).rejects.toThrow(/invalid storage key/);
  });

  it("knows its own files by a base URL written any way, as well as the address saved as a link (URL.href)", async () => {
    for (const publicBaseUrl of ["https://CDN.Example.com:443/photos", "https://cdn.example.com/photos/", "https://bücher.example/photos"]) {
      const storage = new S3Storage({ bucket: "b", region: "auto", forcePathStyle: false, publicBaseUrl }, fakeS3().client);
      const saved = await storage.save({ tenantId: TENANT, buffer: Buffer.from("jpg"), mime: "image/jpeg", extension: "jpg" });
      expect(storage.keyFromUrl(saved.url), publicBaseUrl).toBe(saved.key);
      // A background photo's address goes through linkUrlSchema, which stores it as the parser writes it.
      const asLink = linkUrlSchema.parse(saved.url);
      expect(storage.keyFromUrl(asLink), asLink).toBe(saved.key);
      expect(storage.keyFromUrl(`https://elsewhere.example.com/photos/${saved.key}`)).toBeNull();
      expect(storage.keyFromUrl(`${new URL(publicBaseUrl).origin}/other/${saved.key}`)).toBeNull();
    }
    expect(new S3Storage({ bucket: "b", region: "auto", forcePathStyle: false, publicBaseUrl: "https://cdn.example.com/photos" }, fakeS3().client).keyFromUrl("not a url")).toBeNull();
  });

  it("is chosen by STORAGE_PROVIDER and needs a bucket and public URL", () => {
    const base = { NODE_ENV: "test", DATABASE_URL: "postgres://unused" };
    expect(createStorage(loadConfig(base)).name).toBe("local-disk");
    expect(createPrivateStorage(loadConfig(base)).name).toBe("local-private");
    expect(() => loadConfig({ ...base, STORAGE_PROVIDER: "s3" })).toThrow(/S3_BUCKET and S3_PUBLIC_BASE_URL/);
    expect(() => loadConfig({ ...base, STORAGE_PROVIDER: "s3", S3_BUCKET: "b", S3_PUBLIC_BASE_URL: "https://cdn", S3_ACCESS_KEY_ID: "only-one" })).toThrow(/both/);
    const s3 = loadConfig({ ...base, STORAGE_PROVIDER: "s3", S3_BUCKET: "b", S3_PUBLIC_BASE_URL: "https://cdn", S3_PRIVATE_BUCKET: "b-private" });
    expect(createStorage(s3).name).toBe("s3");
    expect(createPrivateStorage(s3).name).toBe("s3-private");
  });
});

const ATTACHMENT = "0b0c6a52-3f4e-4b7d-8c1a-5e6f7a8b9c0d";
const keyOf = (ext: string) => `${TENANT}/9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a.${ext}`;

describe("private storage keys and dispositions", () => {
  it("allows only <tenant>/<uuid> keys of the four kinds kept", () => {
    for (const ext of ["jpg", "png", "webp", "pdf"]) expect(PRIVATE_KEY_PATTERN.test(keyOf(ext)), ext).toBe(true);
    for (const bad of [
      keyOf("svg"),
      keyOf("html"),
      keyOf("pdf.html"),
      `${keyOf("pdf")}\n`,
      `../${keyOf("pdf")}`,
      `${TENANT}/../${TENANT}/x.pdf`,
      `${TENANT}/9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a/../x.pdf`,
      `${TENANT}\\9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a.pdf`,
      `/${keyOf("pdf")}`,
      keyOf("pdf").toUpperCase(),
      "",
    ]) {
      expect(PRIVATE_KEY_PATTERN.test(bad), bad).toBe(false);
    }
  });

  it("shows photos in place, downloads a photo as 'photo', and always downloads a PDF under its own name", () => {
    const photo = { storageKey: keyOf("png"), thumbKey: keyOf("webp"), contentType: "image/png", fileName: null };
    const pdf = { storageKey: keyOf("pdf"), thumbKey: null, contentType: "application/pdf", fileName: "Fee receipt.pdf" };
    expect(privateCopy(photo, "full")).toEqual({ key: photo.storageKey, contentType: "image/png", disposition: "inline" });
    expect(privateCopy(photo, "thumb")).toEqual({ key: photo.thumbKey, contentType: "image/webp", disposition: "inline" });
    expect(privateCopy(photo, "download")).toEqual({ key: photo.storageKey, contentType: "image/png", disposition: `attachment; filename="photo.png"; filename*=UTF-8''photo.png` });
    const asDownload = `attachment; filename="Fee receipt.pdf"; filename*=UTF-8''Fee%20receipt.pdf`;
    expect(privateCopy(pdf, "full")).toEqual({ key: pdf.storageKey, contentType: "application/pdf", disposition: asDownload });
    expect(privateCopy(pdf, "download")?.disposition).toBe(asDownload);
    expect(privateCopy(pdf, "thumb")).toBeNull();
    expect(privateFileDisposition({ contentType: "application/pdf", fileName: null }, "full")).toContain('filename="Document.pdf"');
    // Only the three photo types ever open in place: any other type, which nothing should store, is a download.
    for (const contentType of ["text/html", "image/svg+xml", "image/gif", "application/octet-stream", ""]) {
      for (const variant of ["full", "download"] as const) {
        expect(privateFileDisposition({ contentType, fileName: null }, variant), `${variant} ${contentType}`).toBe(`attachment; filename="file"; filename*=UTF-8''file`);
      }
      expect(linkDispositionOverride("download", contentType), contentType).toBeNull();
    }
    // Only a photo's download asks for a disposition in its link, and that one names no one's file.
    expect(linkDispositionOverride("download", "image/jpeg")).toBe(`attachment; filename="photo.jpg"; filename*=UTF-8''photo.jpg`);
    for (const [variant, type] of [["full", "image/jpeg"], ["thumb", "image/webp"], ["full", "application/pdf"], ["download", "application/pdf"]] as const) {
      expect(linkDispositionOverride(variant, type), `${variant} ${type}`).toBeNull();
    }
  });
});

describe("local private storage", () => {
  let dir: string;
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });
  const KEY = "l".repeat(40);

  it("saves under the institution with the type's extension, links through /files and deletes", async () => {
    dir = await mkdtemp(join(tmpdir(), "illuminize-private-"));
    const storage = new LocalPrivateStorage(dir, "http://localhost:4000/", KEY);
    const pdf = await storage.save({ tenantId: TENANT, buffer: Buffer.from("%PDF-1.4"), mime: "application/pdf", fileName: "notes.pdf" });
    expect(pdf.key).toMatch(new RegExp(`^${TENANT}/[0-9a-f-]{36}\\.pdf$`));
    expect(await readFile(join(dir, pdf.key), "utf8")).toBe("%PDF-1.4");
    const photo = await storage.save({ tenantId: TENANT, buffer: Buffer.from("webp"), mime: "image/webp", fileName: null });
    expect(photo.key).toMatch(/\.webp$/);
    expect(photo.key).not.toBe(pdf.key);

    const before = Math.floor(Date.now() / 1000);
    const url = await storage.link({ attachmentId: ATTACHMENT, key: pdf.key, variant: "download", contentType: "application/pdf", ttlSec: 600 });
    expect(url.startsWith("http://localhost:4000/files/")).toBe(true);
    const token = url.slice("http://localhost:4000/files/".length);
    // The token names the attachment, not the file: no key, no tenant.
    expect(url).not.toContain(TENANT);
    expect(Buffer.from(token.split(".")[0]!, "base64url").toString()).not.toContain(pdf.key);
    const claim = storage.verify(token)!;
    expect(claim).toMatchObject({ attachmentId: ATTACHMENT, variant: "download" });
    expect(claim.expiresAt - before).toBeGreaterThanOrEqual(600);
    expect(claim.expiresAt - before).toBeLessThanOrEqual(601);
    expect(storage.verify(token, (claim.expiresAt + 1) * 1000)).toBeNull();
    // Another key doesn't accept it, so FILE_URL_KEY (or JWT_SECRET) is what a link rests on.
    expect(new LocalPrivateStorage(dir, "http://localhost:4000", "m".repeat(40)).verify(token)).toBeNull();

    await storage.delete(pdf.key);
    await expect(stat(join(dir, pdf.key))).rejects.toThrow();
    await storage.delete(pdf.key); // deleting again is fine
    await storage.delete(photo.key);
    await expect(storage.delete(`${TENANT}/../../x.pdf`)).rejects.toThrow(/invalid private storage key/);
    await expect(storage.save({ tenantId: "../escape", buffer: Buffer.from("x"), mime: "image/png", fileName: null })).rejects.toThrow(/invalid private storage key/);
  });
});

describe("S3 private storage", () => {
  const cfg = { bucket: "illuminize-private", region: "us-east-1", forcePathStyle: true };

  it("puts objects that are never cached, with their type and the disposition it calls for, and no ACL", async () => {
    const s3 = fakeS3();
    const storage = new S3PrivateStorage(cfg, s3.client);
    const saved = await storage.save({ tenantId: TENANT, buffer: Buffer.from("%PDF-1.4"), mime: "application/pdf", fileName: "notes.pdf" });
    expect(saved.key).toMatch(new RegExp(`^${TENANT}/[0-9a-f-]{36}\\.pdf$`));
    const put = s3.commands[0] as PutObjectCommand;
    expect(put).toBeInstanceOf(PutObjectCommand);
    expect(put.input).toMatchObject({
      Bucket: "illuminize-private",
      Key: saved.key,
      ContentType: "application/pdf",
      CacheControl: "private, no-store",
      ContentDisposition: `attachment; filename="notes.pdf"; filename*=UTF-8''notes.pdf`,
    });
    expect(put.input.ACL).toBeUndefined();
    await storage.delete(saved.key);
    expect((s3.commands[1] as DeleteObjectCommand).input).toEqual({ Bucket: "illuminize-private", Key: saved.key });
    await expect(storage.delete("../../etc/passwd")).rejects.toThrow(/invalid private storage key/);
  });

  it("saves every PDF as a download and only photos to open in place, as /files sends them on local disk", async () => {
    const s3 = fakeS3();
    const storage = new S3PrivateStorage(cfg, s3.client);
    const saved = async (mime: "image/jpeg" | "image/png" | "image/webp" | "application/pdf", fileName: string | null) => {
      await storage.save({ tenantId: TENANT, buffer: Buffer.from("bytes"), mime, fileName });
      return (s3.commands.at(-1) as PutObjectCommand).input.ContentDisposition;
    };
    for (const mime of ["image/jpeg", "image/png", "image/webp"] as const) expect(await saved(mime, null), mime).toBe("inline");
    // No caller picks a PDF's disposition: it is a download under its name, or under "Document.pdf" without one.
    expect(await saved("application/pdf", "Fee receipt.pdf")).toBe(`attachment; filename="Fee receipt.pdf"; filename*=UTF-8''Fee%20receipt.pdf`);
    expect(await saved("application/pdf", null)).toBe(`attachment; filename="Document.pdf"; filename*=UTF-8''Document.pdf`);
    expect(await saved("application/pdf", " ​ ")).toBe(`attachment; filename="Document.pdf"; filename*=UTF-8''Document.pdf`);
  });

  it("presigns a GET for the TTL, asking for a disposition only for a photo's download", async () => {
    const signed: Array<{ input: GetObjectCommand["input"]; expiresIn: number }> = [];
    const storage = new S3PrivateStorage(cfg, fakeS3().client, async (_client, command, options) => {
      signed.push({ input: command.input, expiresIn: options.expiresIn });
      return "https://signed.example/x";
    });
    const link = (key: string, variant: "full" | "thumb" | "download", contentType: string, ttlSec = 600) => storage.link({ attachmentId: ATTACHMENT, key, variant, contentType, ttlSec });
    expect(await link(keyOf("jpg"), "full", "image/jpeg")).toBe("https://signed.example/x");
    await link(keyOf("webp"), "thumb", "image/webp");
    await link(keyOf("jpg"), "download", "image/jpeg", 900);
    await link(keyOf("pdf"), "download", "application/pdf");
    expect(signed).toEqual([
      { input: { Bucket: "illuminize-private", Key: keyOf("jpg") }, expiresIn: 600 },
      { input: { Bucket: "illuminize-private", Key: keyOf("webp") }, expiresIn: 600 },
      { input: { Bucket: "illuminize-private", Key: keyOf("jpg"), ResponseContentDisposition: `attachment; filename="photo.jpg"; filename*=UTF-8''photo.jpg` }, expiresIn: 900 },
      { input: { Bucket: "illuminize-private", Key: keyOf("pdf") }, expiresIn: 600 },
    ]);
    await expect(link("../x.pdf", "full", "application/pdf")).rejects.toThrow(/invalid private storage key/);
  });

  it("signs with the real AWS SDK: path-style on a custom endpoint, expiring, and naming no one's file", async () => {
    const storage = new S3PrivateStorage({ ...cfg, endpoint: "http://127.0.0.1:9000", credentials: { accessKeyId: "minioadmin", secretAccessKey: "minioadmin" } });
    const full = new URL(await storage.link({ attachmentId: ATTACHMENT, key: keyOf("png"), variant: "full", contentType: "image/png", ttlSec: 600 }));
    expect(full.origin).toBe("http://127.0.0.1:9000");
    expect(full.pathname).toBe(`/illuminize-private/${keyOf("png")}`);
    expect(full.searchParams.get("X-Amz-Expires")).toBe("600");
    expect(full.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(full.searchParams.get("X-Amz-Credential")).toMatch(/^minioadmin\//);
    expect(full.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(full.searchParams.has("response-content-disposition")).toBe(false);

    const download = new URL(await storage.link({ attachmentId: ATTACHMENT, key: keyOf("png"), variant: "download", contentType: "image/png", ttlSec: 900 }));
    expect(download.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(download.searchParams.get("response-content-disposition")).toBe(`attachment; filename="photo.png"; filename*=UTF-8''photo.png`);

    const pdf = await storage.link({ attachmentId: ATTACHMENT, key: keyOf("pdf"), variant: "download", contentType: "application/pdf", ttlSec: 600 });
    expect(new URL(pdf).searchParams.has("response-content-disposition")).toBe(false);
  });

  it("puts with the real AWS SDK, sending the headers the bucket answers with", async () => {
    const requests: Array<{ method: string; url: string; headers: http.IncomingHttpHeaders }> = [];
    const server = http.createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        requests.push({ method: req.method!, url: req.url!, headers: req.headers });
        res.writeHead(200, { ETag: '"abc"' });
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const storage = new S3PrivateStorage({ ...cfg, endpoint: `http://127.0.0.1:${port}`, credentials: { accessKeyId: "minioadmin", secretAccessKey: "minioadmin" } });
      const saved = await storage.save({ tenantId: TENANT, buffer: Buffer.from("%PDF-1.4"), mime: "application/pdf", fileName: "Résumé.pdf" });
      const put = requests[0]!;
      expect(put.method).toBe("PUT");
      expect(put.url.split("?")[0]).toBe(`/illuminize-private/${saved.key}`);
      expect(put.headers["content-type"]).toBe("application/pdf");
      expect(put.headers["cache-control"]).toBe("private, no-store");
      expect(put.headers["content-disposition"]).toBe(`attachment; filename="Resume.pdf"; filename*=UTF-8''R%C3%A9sum%C3%A9.pdf`);
      expect(put.headers["x-amz-acl"]).toBeUndefined();
    } finally {
      server.close();
    }
  });
});

describe("S3 storage with the real AWS SDK", () => {
  it("sends signed, path-style PUT and DELETE requests to a custom endpoint (MinIO, R2, Spaces)", async () => {
    const requests: Array<{ method: string; url: string; headers: http.IncomingHttpHeaders; body: Buffer }> = [];
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        requests.push({ method: req.method!, url: req.url!, headers: req.headers, body: Buffer.concat(chunks) });
        res.writeHead(req.method === "DELETE" ? 204 : 200, { ETag: '"abc"' });
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const storage = new S3Storage({
        bucket: "illuminize",
        region: "us-east-1",
        endpoint: `http://127.0.0.1:${port}`,
        forcePathStyle: true,
        publicBaseUrl: `http://127.0.0.1:${port}/illuminize`,
        credentials: { accessKeyId: "minioadmin", secretAccessKey: "minioadmin" },
      });
      const saved = await storage.save({ tenantId: TENANT, buffer: Buffer.from("image-bytes"), mime: "image/webp", extension: "webp" });
      expect(saved.url).toBe(`http://127.0.0.1:${port}/illuminize/${saved.key}`);
      const put = requests[0]!;
      expect(put.method).toBe("PUT");
      expect(put.url.split("?")[0]).toBe(`/illuminize/${saved.key}`);
      expect(put.headers["content-type"]).toBe("image/webp");
      expect(put.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
      expect(put.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=minioadmin\//);
      expect(put.body.toString()).toBe("image-bytes");

      await storage.delete(saved.key);
      expect(requests[1]).toMatchObject({ method: "DELETE" });
      expect(requests[1]!.url.split("?")[0]).toBe(`/illuminize/${saved.key}`);
    } finally {
      server.close();
    }
  });
});

describe("local disk storage", () => {
  let dir: string;
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); // Windows: antivirus can hold files briefly
  });

  it("saves, maps URLs back to keys and deletes", async () => {
    dir = await mkdtemp(join(tmpdir(), "illuminize-uploads-"));
    const storage = new LocalDiskStorage(dir, "http://localhost:4000/");
    const saved = await storage.save({ tenantId: TENANT, buffer: Buffer.from("hello"), mime: "image/png", extension: "png" });
    expect(saved.url).toBe(`http://localhost:4000/uploads/${saved.key}`);
    expect(await readFile(join(dir, saved.key), "utf8")).toBe("hello");
    expect(storage.keyFromUrl(saved.url)).toBe(saved.key);
    expect(storage.keyFromUrl("http://localhost:4000/uploads/../secrets.png")).toBeNull();
    expect(storage.keyFromUrl(`http://localhost:4000/uploads/x/../../${saved.key}`)).toBeNull();
    // An upper-case host or a default port in PUBLIC_BASE_URL still matches the address saved as a link.
    const shouty = new LocalDiskStorage(dir, "http://LOCALHOST:80");
    const other = await shouty.save({ tenantId: TENANT, buffer: Buffer.from("hi"), mime: "image/png", extension: "png" });
    expect(other.url).toBe(`http://LOCALHOST:80/uploads/${other.key}`);
    expect(shouty.keyFromUrl(other.url)).toBe(other.key);
    expect(shouty.keyFromUrl(linkUrlSchema.parse(other.url))).toBe(other.key);
    await shouty.delete(other.key);
    await storage.delete(saved.key);
    await expect(stat(join(dir, saved.key))).rejects.toThrow();
    await storage.delete(saved.key); // deleting again is fine
    await expect(storage.delete(`${TENANT}/../../x.png`)).rejects.toThrow(/invalid storage key/);
  });
});
