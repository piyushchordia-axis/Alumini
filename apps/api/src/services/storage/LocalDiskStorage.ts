import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { StorageProvider, StoredFile } from "./StorageProvider";

/** Development storage: files land under UPLOAD_DIR/<tenantId>/ and are served by Express at /uploads. */
export class LocalDiskStorage implements StorageProvider {
  readonly name = "local-disk";

  constructor(
    private readonly baseDir: string,
    private readonly publicBaseUrl: string,
  ) {}

  async save(input: { tenantId: string; buffer: Buffer; mime: string; extension: string }): Promise<StoredFile> {
    const dir = join(this.baseDir, input.tenantId);
    await mkdir(dir, { recursive: true });
    const key = `${input.tenantId}/${randomUUID()}.${input.extension}`;
    await writeFile(join(this.baseDir, key), input.buffer);
    return { key, url: `${this.publicBaseUrl.replace(/\/$/, "")}/uploads/${key}` };
  }
}
