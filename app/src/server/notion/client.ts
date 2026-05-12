import pLimit from 'p-limit';
import { type Dispatcher, request } from 'undici';

const BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

// Undici / Node networking errors we consider transient and retry-worthy.
// Notion API itself returning 429 / 5xx is handled separately by status code.
const RETRYABLE_ERROR_CODES = new Set([
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
]);

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
    this.timeoutMs = opts.timeoutMs ?? 60_000;
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
        let res: Dispatcher.ResponseData;
        try {
          res = await request(`${BASE}${path}`, {
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
        } catch (err) {
          // Transient network errors (timeouts, socket drops) throw rather
          // than returning a status. Retry the same way we do for 5xx.
          if (isTransientNetworkError(err) && attempt < this.maxRetries) {
            const waitMs = this.backoffBaseMs * 2 ** attempt;
            await new Promise((r) => setTimeout(r, waitMs));
            attempt++;
            continue;
          }
          throw err;
        }

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

function isTransientNetworkError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: string }).code;
  if (code && RETRYABLE_ERROR_CODES.has(code)) return true;
  // Some undici versions expose the kind through `name` instead of `code`.
  const name = (err as { name?: string }).name;
  if (name === 'HeadersTimeoutError' || name === 'BodyTimeoutError') return true;
  if (name === 'ConnectTimeoutError' || name === 'SocketError') return true;
  return false;
}
