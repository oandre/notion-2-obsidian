import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { URL as NodeURL } from 'node:url';
import pLimit from 'p-limit';
import { request } from 'undici';

export class AttachmentDownloader {
  private readonly assetsDir: string;
  private readonly limit: ReturnType<typeof pLimit>;
  private readonly cache = new Map<string, string>();
  private readonly locks = new Map<string, Promise<string>>();
  private closed = false;

  constructor(assetsDir: string, concurrency = 8) {
    this.assetsDir = assetsDir;
    this.limit = pLimit(concurrency);
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  async download(url: string): Promise<string> {
    const cached = this.cache.get(url);
    if (cached) return cached;
    const inflight = this.locks.get(url);
    if (inflight) return inflight;

    const promise = this.limit(async () => {
      if (this.closed) throw new Error('downloader closed');
      const local = this.targetPath(url);
      await mkdir(this.assetsDir, { recursive: true });
      const res = await request(url);
      if (res.statusCode >= 400) {
        await res.body.dump();
        throw new Error(`download failed ${url}: ${res.statusCode}`);
      }
      const buf = Buffer.from(await res.body.arrayBuffer());
      await writeFile(local, buf);
      this.cache.set(url, local);
      return local;
    });
    this.locks.set(url, promise);
    try {
      return await promise;
    } finally {
      this.locks.delete(url);
    }
  }

  private targetPath(url: string): string {
    const hash = createHash('sha1').update(url).digest('hex').slice(0, 8);
    let base = 'file';
    try {
      const u = new NodeURL(url);
      base = u.pathname.split('/').pop() || 'file';
    } catch {
      // keep default
    }
    return join(this.assetsDir, `${hash}-${base}`);
  }
}
