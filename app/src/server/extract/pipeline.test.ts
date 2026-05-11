import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Dispatcher, MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NotionClient } from '../notion/client.js';
import { EventBus } from '../progress.js';
import { runExtraction } from './pipeline.js';

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
  return [
    {
      type: 'text',
      text: { content: text, link: null },
      plain_text: text,
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
  ];
}

async function tmp() {
  return mkdtemp(join(tmpdir(), 'pipe-'));
}

describe('runExtraction', () => {
  it('writes md for a simple page', async () => {
    const dir = await tmp();
    const pool = mock.get('https://api.notion.com');
    pool.intercept({ path: '/v1/pages/p1', method: 'GET' }).reply(200, {
      id: 'p1',
      properties: { title: { type: 'title', title: rich('Hello') } },
    });
    pool.intercept({ path: '/v1/blocks/p1/children?page_size=100', method: 'GET' }).reply(200, {
      results: [
        {
          id: 'b1',
          type: 'paragraph',
          has_children: false,
          paragraph: { rich_text: rich('world') },
        },
      ],
      next_cursor: null,
      has_more: false,
    });

    const client = new NotionClient({ token: 't' });
    const bus = new EventBus();
    const result = await runExtraction({
      client,
      bus,
      outputDir: dir,
      rootSelection: [{ id: 'p1', kind: 'page' }],
    });
    const md = await readFile(join(dir, 'Hello.md'), 'utf8');
    expect(md).toContain('world');
    expect(result.pagesExtracted).toBe(1);
  });

  it('resolves internal wikilink to a child page', async () => {
    const dir = await tmp();
    const pool = mock.get('https://api.notion.com');
    pool.intercept({ path: '/v1/pages/p1', method: 'GET' }).reply(200, {
      id: 'p1',
      properties: { title: { type: 'title', title: rich('Alpha') } },
    });
    pool.intercept({ path: '/v1/blocks/p1/children?page_size=100', method: 'GET' }).reply(200, {
      results: [
        {
          id: 'lb',
          type: 'link_to_page',
          has_children: false,
          link_to_page: { type: 'page_id', page_id: 'cp' },
        },
        {
          id: 'cp',
          type: 'child_page',
          has_children: false,
          child_page: { title: 'Beta' },
        },
      ],
      next_cursor: null,
      has_more: false,
    });
    pool
      .intercept({ path: '/v1/blocks/cp/children?page_size=100', method: 'GET' })
      .reply(200, { results: [], next_cursor: null, has_more: false });

    const client = new NotionClient({ token: 't' });
    const bus = new EventBus();
    await runExtraction({
      client,
      bus,
      outputDir: dir,
      rootSelection: [{ id: 'p1', kind: 'page' }],
    });
    const alpha = await readFile(join(dir, 'Alpha.md'), 'utf8');
    expect(alpha).toContain('[[Beta]]');
  });
});
