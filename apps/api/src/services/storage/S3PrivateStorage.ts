import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { assertPrivateKey, linkDispositionOverride, PRIVATE_EXTENSIONS, privateFileDisposition, type PrivateLinkInput, type PrivateSaveInput, type PrivateStorage } from "./PrivateStorage";

export interface S3PrivateStorageConfig {
  /** S3_PRIVATE_BUCKET: never S3_BUCKET, and with no public access or CDN. */
  bucket: string;
  region: string;
  endpoint?: string;
  forcePathStyle: boolean;
  credentials?: { accessKeyId: string; secretAccessKey: string };
}

export type Presigner = (client: S3Client, command: GetObjectCommand, options: { expiresIn: number }) => Promise<string>;

/**
 * Chat files in their own bucket, opened through presigned GETs. Each object is saved with its type, `private, no-store`
 * and its disposition (a PDF as a download under its name), so a link carries no name: only a photo's download asks for
 * another disposition, and that one says "photo". S3 can't send nosniff, but every object's type was decided by its bytes,
 * and the bucket's own domain keeps a file away from the apps' cookies and storage. A presigned link can't be revoked
 * before it expires.
 */
export class S3PrivateStorage implements PrivateStorage {
  readonly name = "s3-private";
  private readonly client: S3Client;

  constructor(
    private readonly cfg: S3PrivateStorageConfig,
    client?: S3Client,
    private readonly presign: Presigner = getSignedUrl,
  ) {
    this.client =
      client ??
      new S3Client({ region: cfg.region, ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}), forcePathStyle: cfg.forcePathStyle, ...(cfg.credentials ? { credentials: cfg.credentials } : {}) });
  }

  async save(input: PrivateSaveInput): Promise<{ key: string }> {
    const key = `${input.tenantId}/${randomUUID()}.${PRIVATE_EXTENSIONS[input.mime]}`;
    assertPrivateKey(key);
    // Worked out from the type and name, as /files does on local disk, so a PDF is a download from either store.
    const disposition = privateFileDisposition({ contentType: input.mime, fileName: input.fileName }, "full");
    await this.client.send(
      new PutObjectCommand({ Bucket: this.cfg.bucket, Key: key, Body: input.buffer, ContentType: input.mime, CacheControl: "private, no-store", ContentDisposition: disposition }),
    );
    return { key };
  }

  async delete(key: string): Promise<void> {
    assertPrivateKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
  }

  async link(input: PrivateLinkInput): Promise<string> {
    assertPrivateKey(input.key);
    const disposition = linkDispositionOverride(input.variant, input.contentType);
    const command = new GetObjectCommand({ Bucket: this.cfg.bucket, Key: input.key, ...(disposition ? { ResponseContentDisposition: disposition } : {}) });
    return this.presign(this.client, command, { expiresIn: input.ttlSec });
  }
}
