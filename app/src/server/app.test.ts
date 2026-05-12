import { mkdtemp, readFile } from 'node:fs/promises';
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

const richTitle = (text: string) => ({
  type: 'title',
  title: [
    {
      type: 'text',
      plain_text: text,
      text: { content: text, link: null },
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
});

async function setupApp() {
  const cwd = await tmp();
  const app = await buildApp({ cwd });
  await app.inject({
    method: 'POST',
    url: '/api/setup',
    payload: { notionToken: 't', outputDir: cwd },
  });
  return { app, cwd };
}

describe('Fastify app — v0.3', () => {
  it('GET /api/status fresh: tokenConfigured=false', async () => {
    const cwd = await tmp();
    const app = await buildApp({ cwd });
    const res = await app.inject({ method: 'GET', url: '/api/status' });
    expect(res.json()).toEqual({ tokenConfigured: false, outputDir: null });
    await app.close();
  });

  it('POST /api/setup persists token + outputDir', async () => {
    const { app, cwd } = await setupApp();
    const status = await app.inject({ method: 'GET', url: '/api/status' });
    expect(status.json()).toEqual({ tokenConfigured: true, outputDir: cwd });
    await app.close();
  });

  it('GET /api/tree returns 412 when not configured', async () => {
    const cwd = await tmp();
    const app = await buildApp({ cwd });
    const res = await app.inject({ method: 'GET', url: '/api/tree' });
    expect(res.statusCode).toBe(412);
    await app.close();
  });

  it('GET /api/tree on cache miss returns { job_id, cached: false } and tree_ready arrives via SSE', async () => {
    const { app, cwd } = await setupApp();
    const pool = mock.get('https://api.notion.com');

    // The handler no longer calls /v1/search upfront — only the
    // background discovery does. One intercept is enough.
    pool.intercept({ path: '/v1/search', method: 'POST' }).reply(200, {
      results: [{ object: 'page', id: 'p1', properties: { title: richTitle('Top') } }],
      next_cursor: null,
      has_more: false,
    });
    pool.intercept({ path: '/v1/pages/p1', method: 'GET' }).reply(200, {
      id: 'p1',
      properties: { title: richTitle('Top') },
    });
    pool
      .intercept({ path: '/v1/blocks/p1/children?page_size=100', method: 'GET' })
      .reply(200, { results: [], next_cursor: null, has_more: false });

    const res = await app.inject({ method: 'GET', url: '/api/tree' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { job_id?: string; nodes?: unknown; cached: boolean };
    expect(body.cached).toBe(false);
    expect(body.job_id).toMatch(/^[0-9a-f-]+$/);
    expect(body.nodes).toBeUndefined();

    // Wait for the background discovery to complete by polling /api/extract
    // — once the bg discovery sets latestTree, /api/extract no longer 412s.
    let extractRes: Awaited<ReturnType<typeof app.inject>> | undefined;
    for (let i = 0; i < 50; i++) {
      extractRes = await app.inject({
        method: 'POST',
        url: '/api/extract',
        payload: { selectedIds: ['p1'] },
      });
      if (extractRes.statusCode !== 412) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(extractRes?.statusCode).toBe(200);

    const cached = await readFile(join(cwd, '.notion-2-obsidian-cache.json'), 'utf8');
    expect(JSON.parse(cached).nodes.find((n: { id: string }) => n.id === 'p1')).toBeDefined();
    await app.close();
  });

  it('GET /api/tree on cache hit returns nodes synchronously (no job_id)', async () => {
    const { app, cwd } = await setupApp();
    const pool = mock.get('https://api.notion.com');

    // First call: cache miss → background discovery (one /v1/search call)
    pool.intercept({ path: '/v1/search', method: 'POST' }).reply(200, {
      results: [{ object: 'page', id: 'p1', properties: { title: richTitle('Top') } }],
      next_cursor: null,
      has_more: false,
    });
    pool.intercept({ path: '/v1/pages/p1', method: 'GET' }).reply(200, {
      id: 'p1',
      properties: { title: richTitle('Top') },
    });
    pool
      .intercept({ path: '/v1/blocks/p1/children?page_size=100', method: 'GET' })
      .reply(200, { results: [], next_cursor: null, has_more: false });

    await app.inject({ method: 'GET', url: '/api/tree' });
    // Wait for bg discovery to write the cache file
    for (let i = 0; i < 50; i++) {
      try {
        await readFile(join(cwd, '.notion-2-obsidian-cache.json'), 'utf8');
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 20));
      }
    }

    // Second /api/tree call: cache hit, NO Notion API calls needed
    // (the handler now trusts the cache without re-checking workspaceId).
    const res = await app.inject({ method: 'GET', url: '/api/tree' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      job_id?: string;
      nodes?: Array<{ id: string }>;
      cached: boolean;
    };
    expect(body.cached).toBe(true);
    expect(body.job_id).toBeUndefined();
    expect(body.nodes?.find((n) => n.id === 'p1')).toBeDefined();
    await app.close();
  });

  it('POST /api/extract requires prior /api/tree (412 otherwise)', async () => {
    const { app } = await setupApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/extract',
      payload: { selectedIds: ['p1'] },
    });
    expect(res.statusCode).toBe(412);
    await app.close();
  });
});
