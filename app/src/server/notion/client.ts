import pLimit from 'p-limit';
import { type Dispatcher, request } from 'undici';

const BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

export interface NotionClientOptions {
  token: string;
  concurrency?: number;
  maxRetries?: number;
  backoffBaseMs?: number;
  timeoutMs?: number;
}

export class NotionClient {
  private readonly token: string;
  private readonly maxRetries: number;
  private readonly backoffBaseMs: number;
  private readonly timeoutMs: number;
  private readonly limit: ReturnType<typeof pLimit>;

  constructor(opts: NotionClientOptions) {
    this.token = opts.token;
    this.maxRetries = opts.maxRetries ?? 5;
    this.backoffBaseMs = opts.backoffBaseMs ?? 500;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.limit = pLimit(opts.concurrency ?? 3);
  }

  get<T = unknown>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  post<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private async request<T>(
    method: Dispatcher.HttpMethod,
    path: string,
    body?: unknown,
  ): Promise<T> {
    return this.limit(async () => {
      let attempt = 0;
      while (true) {
        const res = await request(`${BASE}${path}`, {
          method,
          headers: {
            authorization: `Bearer ${this.token}`,
            'notion-version': NOTION_VERSION,
            'content-type': 'application/json',
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          headersTimeout: this.timeoutMs,
          bodyTimeout: this.timeoutMs,
        });

        if (res.statusCode < 400) {
          return (await res.body.json()) as T;
        }

        const retryable =
          res.statusCode === 429 || (res.statusCode >= 500 && res.statusCode <= 599);
        if (retryable && attempt < this.maxRetries) {
          const retryAfter = Number(res.headers['retry-after'] ?? 0);
          const waitMs = Math.max(retryAfter * 1000, this.backoffBaseMs * 2 ** attempt);
          await res.body.dump();
          await new Promise((r) => setTimeout(r, waitMs));
          attempt++;
          continue;
        }

        const text = await res.body.text();
        throw new Error(`Notion API ${method} ${path} → ${res.statusCode}: ${text}`);
      }
    });
  }
}
