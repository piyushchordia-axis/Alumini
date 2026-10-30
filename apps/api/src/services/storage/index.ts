import type { Config } from "../../config/env";
import { LocalDiskStorage } from "./LocalDiskStorage";
import type { StorageProvider } from "./StorageProvider";

export type { StorageProvider, StoredFile } from "./StorageProvider";
export { LocalDiskStorage };

/** Swap in an S3-compatible provider here for production. */
export function createStorage(config: Config): StorageProvider {
  return new LocalDiskStorage(config.uploadDirAbsolute, config.PUBLIC_BASE_URL);
}
