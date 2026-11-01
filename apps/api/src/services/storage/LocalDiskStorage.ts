import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { STORAGE_KEY_PATTERN, type StorageProvider, type StoredFile } from "./StorageProvider";

/**
 * Files under UPLOAD_DIR/<tenantId>/, served by Express at /uploads. Fine for development and single-server setups;
 * use S3-compatible storage when the API runs on more than one machine or on ephemeral disks.
 */
export class LocalDiskStorage implements StorageProvider {
  readonly name = "local-disk";
  private readonly urlPrefix: string;

  constructor(
    private readonly baseDir: string,
    publicBaseUrl: string,
  ) {
    this.urlPrefix = `${publicBaseUrl.replace(/\/$/, "")}/uploads/`;
  }

  async save(input: { tenantId: string; buffer: Buffer; mime: string; extension: string }): Promise<StoredFile> {
    const dir = join(this.baseDir, input.tenantId);
    await mkdir(dir, { recursive: true });
    const key = `${input.tenantId}/${randomUUID()}.${input.extension}`;
    await writeFile(join(this.baseDir, key), input.buffer);
    return { key, url: `${this.urlPrefix}${key}` };
  }

  async delete(key: string): Promise<void> {
    if (!STORAGE_KEY_PATTERN.test(key)) throw new Error(`Refusing to delete invalid storage key "${key}"`);
    await rm(join(this.baseDir, key), { force: true });
  }

  keyFromUrl(url: string): string | null {
    if (!url.startsWith(this.urlPrefix)) return null;
    const key = url.slice(this.urlPrefix.length);
    return STORAGE_KEY_PATTERN.test(key) ? key : null;
  }
}
