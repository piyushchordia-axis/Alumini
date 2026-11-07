import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { signFileLink, verifyFileLink, type FileLinkClaim } from "../../lib/fileLinks";
import { assertPrivateKey, PRIVATE_EXTENSIONS, type PrivateLinkInput, type PrivateSaveInput, type PrivateStorage } from "./PrivateStorage";

/**
 * Chat files under PRIVATE_UPLOAD_DIR/<tenantId>/, which nothing serves as it is. A link is
 * `PUBLIC_BASE_URL/files/<token>`, signed with FILE_URL_KEY; routes/files.routes.ts checks it and looks the attachment up
 * again before sending a byte, so a deleted one stops opening at once. For one server with a persistent disk, like
 * LocalDiskStorage.
 */
export class LocalPrivateStorage implements PrivateStorage {
  readonly name = "local-private";
  private readonly urlPrefix: string;

  constructor(
    readonly root: string,
    publicBaseUrl: string,
    private readonly linkKey: string | Buffer,
  ) {
    this.urlPrefix = `${publicBaseUrl.replace(/\/+$/, "")}/files/`;
  }

  async save(input: PrivateSaveInput): Promise<{ key: string }> {
    const key = `${input.tenantId}/${randomUUID()}.${PRIVATE_EXTENSIONS[input.mime]}`;
    assertPrivateKey(key);
    // Readable by this server's user alone, where the file system has permissions.
    await mkdir(join(this.root, input.tenantId), { recursive: true, mode: 0o700 });
    await writeFile(join(this.root, key), input.buffer, { flag: "wx", mode: 0o600 });
    return { key };
  }

  async delete(key: string): Promise<void> {
    assertPrivateKey(key);
    await rm(join(this.root, key), { force: true });
  }

  async link(input: PrivateLinkInput): Promise<string> {
    const expiresAt = Math.floor(Date.now() / 1000) + input.ttlSec;
    return `${this.urlPrefix}${signFileLink(this.linkKey, { attachmentId: input.attachmentId, variant: input.variant, expiresAt })}`;
  }

  /** What a /files token opens, or null when it isn't one of ours, was changed or has expired. */
  verify(token: string, nowMs?: number): FileLinkClaim | null {
    return verifyFileLink(this.linkKey, token, nowMs);
  }
}
