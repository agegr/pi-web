import { Buffer } from "node:buffer";

interface PreviewEntry {
  html: string;
  bytes: number;
}

export function documentPreviewCacheKey(filePath: string, etag: string): string {
  return `${filePath}\0${etag}`;
}

export class DocumentPreviewCache {
  private readonly entries = new Map<string, PreviewEntry>();
  private readonly inFlight = new Map<string, Promise<string>>();
  private totalBytes = 0;

  constructor(
    private readonly maxEntries: number,
    private readonly maxBytes: number,
  ) {}

  get(key: string): string | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.html;
  }

  set(key: string, html: string): void {
    const bytes = Buffer.byteLength(html);
    const previous = this.entries.get(key);
    if (previous) {
      this.entries.delete(key);
      this.totalBytes -= previous.bytes;
    }
    if (bytes > this.maxBytes || this.maxEntries <= 0 || this.maxBytes <= 0) return;

    this.entries.set(key, { html, bytes });
    this.totalBytes += bytes;
    while (this.entries.size > this.maxEntries || this.totalBytes > this.maxBytes) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      const oldest = this.entries.get(oldestKey);
      this.entries.delete(oldestKey);
      this.totalBytes -= oldest?.bytes ?? 0;
    }
  }

  async getOrCreate(key: string, create: () => Promise<string>): Promise<string> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;

    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const pending = create().then((html) => {
      this.set(key, html);
      return html;
    }).finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, pending);
    return pending;
  }

  stats(): { entries: number; bytes: number; inFlight: number } {
    return {
      entries: this.entries.size,
      bytes: this.totalBytes,
      inFlight: this.inFlight.size,
    };
  }
}

const documentPreviewCache = new DocumentPreviewCache(8, 32 * 1024 * 1024);

export function getOrCreateDocumentPreview(
  key: string,
  create: () => Promise<string>,
): Promise<string> {
  return documentPreviewCache.getOrCreate(key, create);
}
