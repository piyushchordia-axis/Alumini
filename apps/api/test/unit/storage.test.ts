import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/env";
import { createStorage, LocalDiskStorage, S3Storage } from "../../src/services/storage";

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

  it("is chosen by STORAGE_PROVIDER and needs a bucket and public URL", () => {
    const base = { NODE_ENV: "test", DATABASE_URL: "postgres://unused" };
    expect(createStorage(loadConfig(base)).name).toBe("local-disk");
    expect(() => loadConfig({ ...base, STORAGE_PROVIDER: "s3" })).toThrow(/S3_BUCKET and S3_PUBLIC_BASE_URL/);
    expect(() => loadConfig({ ...base, STORAGE_PROVIDER: "s3", S3_BUCKET: "b", S3_PUBLIC_BASE_URL: "https://cdn", S3_ACCESS_KEY_ID: "only-one" })).toThrow(/both/);
    expect(createStorage(loadConfig({ ...base, STORAGE_PROVIDER: "s3", S3_BUCKET: "b", S3_PUBLIC_BASE_URL: "https://cdn" })).name).toBe("s3");
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
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("saves, maps URLs back to keys and deletes", async () => {
    dir = await mkdtemp(join(tmpdir(), "illuminize-uploads-"));
    const storage = new LocalDiskStorage(dir, "http://localhost:4000/");
    const saved = await storage.save({ tenantId: TENANT, buffer: Buffer.from("hello"), mime: "image/png", extension: "png" });
    expect(saved.url).toBe(`http://localhost:4000/uploads/${saved.key}`);
    expect(await readFile(join(dir, saved.key), "utf8")).toBe("hello");
    expect(storage.keyFromUrl(saved.url)).toBe(saved.key);
    expect(storage.keyFromUrl("http://localhost:4000/uploads/../secrets.png")).toBeNull();
    await storage.delete(saved.key);
    await expect(stat(join(dir, saved.key))).rejects.toThrow();
    await storage.delete(saved.key); // deleting again is fine
    await expect(storage.delete(`${TENANT}/../../x.png`)).rejects.toThrow(/invalid storage key/);
  });
});
