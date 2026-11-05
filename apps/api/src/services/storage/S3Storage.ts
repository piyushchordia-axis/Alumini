import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { keyAfterPrefix, STORAGE_KEY_PATTERN, type StorageProvider, type StoredFile } from "./StorageProvider";

export interface S3StorageConfig {
  bucket: string;
  region: string;
  /** Custom endpoint for S3-compatible services (Cloudflare R2, DigitalOcean Spaces, MinIO). */
  endpoint?: string;
  forcePathStyle: boolean;
  /** Public URL prefix for objects: the bucket's public URL or a CDN in front of it. */
  publicBaseUrl: string;
  /** Omit to use the default AWS credential chain (instance role, env, profile). */
  credentials?: { accessKeyId: string; secretAccessKey: string };
}

/**
 * S3-compatible object storage (AWS S3, Cloudflare R2, DigitalOcean Spaces, MinIO). Objects are immutable (every
 * upload gets a new key), so they are cached for a year. No ACL is set: make the bucket (or the CDN) publicly readable.
 */
export class S3Storage implements StorageProvider {
  readonly name = "s3";
  private readonly client: Pick<S3Client, "send">;
  private readonly urlPrefix: string;

  constructor(
    private readonly cfg: S3StorageConfig,
    client?: Pick<S3Client, "send">,
  ) {
    this.client =
      client ??
      new S3Client({ region: cfg.region, ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}), forcePathStyle: cfg.forcePathStyle, ...(cfg.credentials ? { credentials: cfg.credentials } : {}) });
    this.urlPrefix = `${cfg.publicBaseUrl.replace(/\/$/, "")}/`;
  }

  async save(input: { tenantId: string; buffer: Buffer; mime: string; extension: string }): Promise<StoredFile> {
    const key = `${input.tenantId}/${randomUUID()}.${input.extension}`;
    await this.client.send(
      new PutObjectCommand({ Bucket: this.cfg.bucket, Key: key, Body: input.buffer, ContentType: input.mime, CacheControl: "public, max-age=31536000, immutable" }),
    );
    return { key, url: `${this.urlPrefix}${key}` };
  }

  async delete(key: string): Promise<void> {
    if (!STORAGE_KEY_PATTERN.test(key)) throw new Error(`Refusing to delete invalid storage key "${key}"`);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
  }

  keyFromUrl(url: string): string | null {
    return keyAfterPrefix(url, this.urlPrefix);
  }
}
