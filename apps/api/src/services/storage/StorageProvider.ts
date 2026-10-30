export interface StoredFile {
  url: string;
  key: string;
}

export interface StorageProvider {
  readonly name: string;
  save(input: { tenantId: string; buffer: Buffer; mime: string; extension: string }): Promise<StoredFile>;
}
