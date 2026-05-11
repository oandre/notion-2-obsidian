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

  it('GET /api/tree fetches and caches on first call', async () => {
    const { app, cwd } = await setupApp();
    const pool = mock.get('https://api.notion.com');

    // /search returns p1
    pool.intercept({ path: '/v1/search', method: 'POST' }).reply(200, {
      results: [{ object: 'page', id: 'p1', properties: { title: richTitle('Top') } }],
      next_cursor: null,
      has_more: false,
    });
    // The /api/tree handler calls listSharedRoots (already done above)
    // then discoverWorkspace, which itself calls listSharedRoots again,
    // then discoverSubtree for p1 (which calls /pages/p1 + /blocks/p1/children).
    // Mock both: a second /search response, plus the two endpoints.
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
    const body = res.json() as {
      nodes: Array<{ id: string }>;
      discoveredAt: string;
      cached: boolean;
    };
    expect(body.nodes.find((n) => n.id === 'p1')).toBeDefined();
    expect(body.cached).toBe(false);

    const cached = await readFile(join(cwd, '.notion-2-obsidian-cache.json'), 'utf8');
    expect(JSON.parse(cached).nodes.find((n: { id: string }) => n.id === 'p1')).toBeDefined();
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
