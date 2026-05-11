import { type Dispatcher, MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NotionClient } from './client.js';
import { fetchBlockChildren, queryDatabase } from './fetch.js';

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

describe('fetchBlockChildren', () => {
  it('paginates', async () => {
    const pool = mock.get('https://api.notion.com');
    pool.intercept({ path: '/v1/blocks/parent/children?page_size=100', method: 'GET' }).reply(200, {
      results: [
        {
          id: 'b1',
          type: 'paragraph',
          has_children: false,
          paragraph: { rich_text: [] },
        },
      ],
      next_cursor: 'cur1',
      has_more: true,
    });
    pool
      .intercept({
        path: '/v1/blocks/parent/children?page_size=100&start_cursor=cur1',
        method: 'GET',
      })
      .reply(200, {
        results: [
          {
            id: 'b2',
            type: 'paragraph',
            has_children: false,
            paragraph: { rich_text: [] },
          },
        ],
        next_cursor: null,
        has_more: false,
      });

    const client = new NotionClient({ token: 't' });
    const blocks = await fetchBlockChildren(client, 'parent');
    expect(blocks.map((b) => b.id)).toEqual(['b1', 'b2']);
  });

  it('recurses into nested blocks (toggle)', async () => {
    const pool = mock.get('https://api.notion.com');
    pool.intercept({ path: '/v1/blocks/parent/children?page_size=100', method: 'GET' }).reply(200, {
      results: [
        {
          id: 'outer',
          type: 'toggle',
          has_children: true,
          toggle: { rich_text: [] },
        },
      ],
      next_cursor: null,
      has_more: false,
    });
    pool.intercept({ path: '/v1/blocks/outer/children?page_size=100', method: 'GET' }).reply(200, {
      results: [
        {
          id: 'inner',
          type: 'paragraph',
          has_children: false,
          paragraph: { rich_text: [] },
        },
      ],
      next_cursor: null,
      has_more: false,
    });

    const client = new NotionClient({ token: 't' });
    const blocks = await fetchBlockChildren(client, 'parent');
    expect(blocks[0]?.id).toBe('outer');
    expect(blocks[0]?.children?.[0]?.id).toBe('inner');
  });

  it('queryDatabase paginates', async () => {
    const pool = mock.get('https://api.notion.com');
    pool.intercept({ path: '/v1/databases/db1/query', method: 'POST' }).reply(200, {
      results: [{ id: 'i1', properties: {} }],
      next_cursor: 'c',
      has_more: true,
    });
    pool.intercept({ path: '/v1/databases/db1/query', method: 'POST' }).reply(200, {
      results: [{ id: 'i2', properties: {} }],
      next_cursor: null,
      has_more: false,
    });

    const client = new NotionClient({ token: 't' });
    const items = await queryDatabase(client, 'db1');
    expect(items.map((i) => i.id)).toEqual(['i1', 'i2']);
  });
});
