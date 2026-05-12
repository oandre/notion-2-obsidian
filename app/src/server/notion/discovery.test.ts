import { type Dispatcher, MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NotionClient } from './client.js';
import { discoverSubtree, discoverWorkspace, listSharedRoots } from './discovery.js';

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

function rich(text: string) {
  return {
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
  };
}

describe('listSharedRoots', () => {
  it('returns pages and databases shared with the integration', async () => {
    const pool = mock.get('https://api.notion.com');
    pool.intercept({ path: '/v1/search', method: 'POST' }).reply(200, {
      results: [
        {
          object: 'page',
          id: 'p1',
          properties: { title: { type: 'title', title: [rich('Notas')] } },
        },
        {
          object: 'database',
          id: 'd1',
          title: [rich('Tarefas')],
        },
      ],
      next_cursor: null,
      has_more: false,
    });

    const client = new NotionClient({ token: 't' });
    const roots = await listSharedRoots(client);
    const ids = new Set(roots.map((r) => r.id));
    expect(ids).toEqual(new Set(['p1', 'd1']));
    expect(roots.find((r) => r.id === 'p1')?.kind).toBe('page');
    expect(roots.find((r) => r.id === 'd1')?.kind).toBe('database');
    expect(roots.find((r) => r.id === 'p1')?.title).toBe('Notas');
    expect(roots.find((r) => r.id === 'd1')?.title).toBe('Tarefas');
  });
});

describe('discoverSubtree', () => {
  it('walks child_page, child_database, and db items; caches blocks on PlannedNode', async () => {
    const pool = mock.get('https://api.notion.com');

    pool.intercept({ path: '/v1/pages/p1', method: 'GET' }).reply(200, {
      id: 'p1',
      properties: { title: { type: 'title', title: [rich('Root')] } },
    });
    pool.intercept({ path: '/v1/blocks/p1/children?page_size=100', method: 'GET' }).reply(200, {
      results: [
        {
          id: 'sub1',
          type: 'child_page',
          child_page: { title: 'Sub' },
          has_children: false,
        },
        {
          id: 'db1',
          type: 'child_database',
          child_database: { title: 'Items' },
          has_children: false,
        },
        {
          id: 'para',
          type: 'paragraph',
          paragraph: { rich_text: [] },
          has_children: false,
        },
      ],
      next_cursor: null,
      has_more: false,
    });
    pool
      .intercept({ path: '/v1/blocks/sub1/children?page_size=100', method: 'GET' })
      .reply(200, { results: [], next_cursor: null, has_more: false });
    pool.intercept({ path: '/v1/databases/db1/query', method: 'POST' }).reply(200, {
      results: [
        {
          id: 'row1',
          properties: { Name: { type: 'title', title: [rich('Row 1')] } },
        },
      ],
      next_cursor: null,
      has_more: false,
    });
    pool
      .intercept({ path: '/v1/blocks/row1/children?page_size=100', method: 'GET' })
      .reply(200, { results: [], next_cursor: null, has_more: false });

    const client = new NotionClient({ token: 't' });
    const nodes = await discoverSubtree(client, 'p1', 'page');
    const ids = new Set(nodes.map((n) => n.id));
    expect(ids).toEqual(new Set(['p1', 'sub1', 'db1', 'row1']));

    const p1 = nodes.find((n) => n.id === 'p1');
    expect(new Set(p1?.childrenIds)).toEqual(new Set(['sub1', 'db1']));

    const db1 = nodes.find((n) => n.id === 'db1');
    expect(db1?.childrenIds).toEqual(['row1']);

    // Caches blocks on the node so the pipeline doesn't refetch
    expect(p1?.blocks).toBeDefined();
    expect(p1?.blocks.length).toBeGreaterThan(0);
  });
});

describe('discoverWorkspace', () => {
  it('walks every root returned by /search', async () => {
    const pool = mock.get('https://api.notion.com');

    pool.intercept({ path: '/v1/search', method: 'POST' }).reply(200, {
      results: [
        {
          object: 'page',
          id: 'p1',
          properties: { title: { type: 'title', title: [rich('Notas')] } },
        },
        { object: 'database', id: 'd1', title: [rich('Tarefas')] },
      ],
      next_cursor: null,
      has_more: false,
    });

    pool.intercept({ path: '/v1/pages/p1', method: 'GET' }).reply(200, {
      id: 'p1',
      properties: { title: { type: 'title', title: [rich('Notas')] } },
    });
    pool
      .intercept({ path: '/v1/blocks/p1/children?page_size=100', method: 'GET' })
      .reply(200, { results: [], next_cursor: null, has_more: false });

    pool.intercept({ path: '/v1/databases/d1', method: 'GET' }).reply(200, {
      id: 'd1',
      title: [rich('Tarefas')],
    });
    pool.intercept({ path: '/v1/databases/d1/query', method: 'POST' }).reply(200, {
      results: [],
      next_cursor: null,
      has_more: false,
    });

    const client = new NotionClient({ token: 't' });
    const nodes = await discoverWorkspace(client);

    expect(new Set(nodes.map((n) => n.id))).toEqual(new Set(['p1', 'd1']));
  });
});

describe('discoverWorkspace with bus', () => {
  it('emits roots_listing, roots_listed, root_started, root_done events', async () => {
    const pool = mock.get('https://api.notion.com');

    pool.intercept({ path: '/v1/search', method: 'POST' }).reply(200, {
      results: [
        {
          object: 'page',
          id: 'p1',
          properties: { title: { type: 'title', title: [rich('Notas')] } },
        },
      ],
      next_cursor: null,
      has_more: false,
    });

    pool.intercept({ path: '/v1/pages/p1', method: 'GET' }).reply(200, {
      id: 'p1',
      properties: { title: { type: 'title', title: [rich('Notas')] } },
    });
    pool
      .intercept({ path: '/v1/blocks/p1/children?page_size=100', method: 'GET' })
      .reply(200, { results: [], next_cursor: null, has_more: false });

    const { discoverWorkspace } = await import('./discovery.js');
    const { EventBus } = await import('../progress.js');
    const bus = new EventBus();
    const collected: Array<{ kind: string; data: Record<string, unknown> }> = [];
    const consumer = (async () => {
      for await (const event of bus.subscribe()) {
        collected.push({ kind: event.kind, data: event.data });
        if (event.kind === 'discovery_done') break;
      }
    })();
    await new Promise((r) => setTimeout(r, 0));

    const client = new NotionClient({ token: 't' });
    const nodes = await discoverWorkspace(client, bus);
    await consumer;

    expect(nodes.map((n) => n.id)).toEqual(['p1']);
    const kinds = collected.map((e) => e.kind);
    expect(kinds).toContain('roots_listing');
    expect(kinds).toContain('roots_listed');
    expect(kinds).toContain('root_started');
    expect(kinds).toContain('root_done');
    expect(kinds).toContain('discovery_done');

    const rootsListed = collected.find((e) => e.kind === 'roots_listed');
    expect(rootsListed?.data).toEqual({ count: 1 });

    const rootStarted = collected.find((e) => e.kind === 'root_started');
    expect(rootStarted?.data).toEqual({ id: 'p1', title: 'Notas', kind: 'page' });

    const rootDone = collected.find((e) => e.kind === 'root_done');
    expect(rootDone?.data).toEqual({
      id: 'p1',
      title: 'Notas',
      pages: 1,
      databases: 0,
      dbItems: 0,
    });
  });
});
