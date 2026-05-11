import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Dispatcher, MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

let mock: MockAgent;
let previous: Dispatcher;

beforeEach(() => {
  previous = getGlobalDispatcher();
  mock = new MockAgent();
  mock.disableNetConnect();
  setGlobalDispatcher(mock);
});

afterEach(async () => {
  await mock.close();
  setGlobalDispatcher(previous);
});

async function tmp() {
  return mkdtemp(join(tmpdir(), 'app-'));
}

describe('Fastify app', () => {
  it('GET /api/status returns tokenConfigured=false on fresh dir', async () => {
    const cwd = await tmp();
    const app = await buildApp({ cwd });
    const res = await app.inject({ method: 'GET', url: '/api/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ tokenConfigured: false, outputDir: null });
    await app.close();
  });

  it('POST /api/setup persists token + outputDir', async () => {
    const cwd = await tmp();
    const app = await buildApp({ cwd });
    const res = await app.inject({
      method: 'POST',
      url: '/api/setup',
      payload: { notionToken: 'secret_zzz', outputDir: '/v' },
    });
    expect(res.statusCode).toBe(204);
    const status = await app.inject({ method: 'GET', url: '/api/status' });
    expect(status.json()).toEqual({ tokenConfigured: true, outputDir: '/v' });
    await app.close();
  });

  it('GET /api/roots returns shared roots when token is configured', async () => {
    const cwd = await tmp();
    const pool = mock.get('https://api.notion.com');
    pool.intercept({ path: '/v1/search', method: 'POST' }).reply(200, {
      results: [
        {
          object: 'page',
          id: 'p1',
          properties: {
            title: {
              type: 'title',
              title: [
                {
                  type: 'text',
                  plain_text: 'Top',
                  text: { content: 'Top', link: null },
                  href: null,
                  annotations: {
                    bold: false,
                    italic: false,
                    strikethrough: false,
                    underline: false,
                    code: false,
                    color: 'default',
                  },
                },
              ],
            },
          },
        },
      ],
      next_cursor: null,
      has_more: false,
    });
    const app = await buildApp({ cwd });
    await app.inject({
      method: 'POST',
      url: '/api/setup',
      payload: { notionToken: 't', outputDir: '/v' },
    });
    const res = await app.inject({ method: 'GET', url: '/api/roots' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ id: 'p1', kind: 'page', title: 'Top' }]);
    await app.close();
  });

  it('GET /api/roots returns 412 when token missing', async () => {
    const cwd = await tmp();
    const app = await buildApp({ cwd });
    const res = await app.inject({ method: 'GET', url: '/api/roots' });
    expect(res.statusCode).toBe(412);
    await app.close();
  });
});
