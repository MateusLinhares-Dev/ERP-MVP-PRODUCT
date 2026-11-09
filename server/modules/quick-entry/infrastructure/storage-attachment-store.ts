import type { AttachmentStorage } from '../application/ports.js';

export interface BucketFile {
  save(content: Buffer, options: Record<string, unknown>): Promise<unknown>;
  download(): Promise<[Buffer]>;
}

export interface BucketLike {
  file(path: string): BucketFile;
}

export class StorageAttachmentStore implements AttachmentStorage {
  constructor(private readonly bucket: BucketLike) {}

  async save(path: string, content: Buffer, contentType: string): Promise<void> {
    await this.bucket.file(path).save(content, {
      resumable: false,
      contentType,
      metadata: { cacheControl: 'private, max-age=0' },
    });
  }

  async read(path: string): Promise<Buffer> {
    const [content] = await this.bucket.file(path).download();
    return content;
  }
}
