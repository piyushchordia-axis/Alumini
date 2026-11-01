import type { Config } from "../../config/env";
import { LocalDiskStorage } from "./LocalDiskStorage";
import { S3Storage } from "./S3Storage";
import type { StorageProvider } from "./StorageProvider";

export type { StorageProvider, StoredFile } from "./StorageProvider";
export { LocalDiskStorage, S3Storage };

/** STORAGE_PROVIDER=local (default) keeps files on disk; s3 uses any S3-compatible bucket. */
export function createStorage(config: Config): StorageProvider {
  if (config.STORAGE_PROVIDER === "s3") {
    return new S3Storage({
      bucket: config.S3_BUCKET!,
      region: config.S3_REGION,
      endpoint: config.S3_ENDPOINT,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      publicBaseUrl: config.S3_PUBLIC_BASE_URL!,
      ...(config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY ? { credentials: { accessKeyId: config.S3_ACCESS_KEY_ID, secretAccessKey: config.S3_SECRET_ACCESS_KEY } } : {}),
    });
  }
  return new LocalDiskStorage(config.uploadDirAbsolute, config.PUBLIC_BASE_URL);
}
