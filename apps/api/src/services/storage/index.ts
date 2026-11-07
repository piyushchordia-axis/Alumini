import type { Config } from "../../config/env";
import { fileLinkKey } from "../../lib/fileLinks";
import { LocalDiskStorage } from "./LocalDiskStorage";
import { LocalPrivateStorage } from "./LocalPrivateStorage";
import type { PrivateStorage } from "./PrivateStorage";
import { S3PrivateStorage } from "./S3PrivateStorage";
import { S3Storage } from "./S3Storage";
import type { StorageProvider } from "./StorageProvider";

export type { StorageProvider, StoredFile } from "./StorageProvider";
export type { PrivateStorage } from "./PrivateStorage";
export { LocalDiskStorage, LocalPrivateStorage, S3PrivateStorage, S3Storage };

const s3Credentials = (config: Config) =>
  config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY ? { credentials: { accessKeyId: config.S3_ACCESS_KEY_ID, secretAccessKey: config.S3_SECRET_ACCESS_KEY } } : {};

/** STORAGE_PROVIDER=local (default) keeps files on disk; s3 uses any S3-compatible bucket. */
export function createStorage(config: Config): StorageProvider {
  if (config.STORAGE_PROVIDER === "s3") {
    return new S3Storage({
      bucket: config.S3_BUCKET!,
      region: config.S3_REGION,
      endpoint: config.S3_ENDPOINT,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      publicBaseUrl: config.S3_PUBLIC_BASE_URL!,
      ...s3Credentials(config),
    });
  }
  return new LocalDiskStorage(config.uploadDirAbsolute, config.PUBLIC_BASE_URL);
}

/** Chat photos and files: PRIVATE_UPLOAD_DIR, served only through signed /files links, or S3_PRIVATE_BUCKET with s3. */
export function createPrivateStorage(config: Config): PrivateStorage {
  if (config.STORAGE_PROVIDER === "s3") {
    return new S3PrivateStorage({ bucket: config.S3_PRIVATE_BUCKET!, region: config.S3_REGION, endpoint: config.S3_ENDPOINT, forcePathStyle: config.S3_FORCE_PATH_STYLE, ...s3Credentials(config) });
  }
  return new LocalPrivateStorage(config.privateUploadDirAbsolute, config.PUBLIC_BASE_URL, fileLinkKey(config));
}
